import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(fs.realpathSync(require.resolve('wrangler/package.json')))
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare')
const origin = 'https://editor.example'
const requests = []
let redirectTarget = ''
const options = {
  modules: true,
  script: fs.readFileSync(new URL('../../../.private-worker-check/index.js', import.meta.url), 'utf8'),
  compatibilityDate: '2026-10-12',
  bindings: {
    APP_ORIGIN: origin,
    ALLOWED_GITHUB_USER_ID: '123',
    DATA_REPO_OWNER: 'owner',
    DATA_REPO_NAME: 'articles',
    DATA_REPO_BRANCH: 'main',
    GITHUB_CLIENT_ID: 'fake-client',
    GITHUB_CLIENT_SECRET: 'fake-client-secret',
    DATA_REPO_TOKEN: 'fake-repo-token',
    SESSION_SECRET: 'fake-signing-secret-for-local-test-only-32-chars',
  },
  serviceBindings: { ASSETS: async () => new Response('shell') },
  outboundService: async (request) => {
    const url = new URL(request.url)
    requests.push(url.origin + url.pathname)
    if (url.pathname === redirectTarget)
      return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/collect' } })
    if (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token')
      return Response.json({ access_token: 'fake-token' })
    if (url.origin === 'https://api.github.com' && url.pathname === '/user')
      return Response.json({ id: 123, login: 'owner' })
    if (url.origin === 'https://api.github.com' && url.pathname === '/repos/owner/articles')
      return Response.json({ id: 456, private: true, permissions: { push: true } })
    throw new Error('Unexpected outbound request; real network is disabled')
  },
}
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options)
const cookies = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
async function login() {
  const start = await mf.dispatchFetch(`${origin}/api/auth/github`, { redirect: 'manual' })
  assert.equal(start.status, 302)
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  return mf.dispatchFetch(`${origin}/api/auth/github/callback?code=fake-code&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: cookies(start) },
  })
}
try {
  assert.equal((await mf.dispatchFetch(`${origin}/api/me`)).status, 401)
  const callback = await login()
  assert.equal(callback.status, 302, 'OAuth callback must work in the Workers runtime')
  assert.equal(callback.headers.get('location'), `${origin}/`)
  const cookie = cookies(callback)
  const me = await mf.dispatchFetch(`${origin}/api/me`, { headers: { cookie } })
  assert.equal(me.status, 200, 'Repository requests must work in the Workers runtime')
  const identity = await me.json()
  assert.equal(identity.ownerId, '123')
  assert.equal(identity.vaultId, '456:main')
  for (const target of ['/login/oauth/access_token', '/user', '/repos/owner/articles']) {
    redirectTarget = target
    const response = target.startsWith('/repos/')
      ? await mf.dispatchFetch(`${origin}/api/me`, { headers: { cookie } })
      : await login()
    assert.equal(response.status, 503, 'Unexpected upstream redirects must fail closed')
  }
  assert.ok(requests.every(url => !url.includes('unexpected.example')))
  console.log('PASS: Workers OAuth, private repository identity, anonymous rejection and redirect isolation (mock upstream; no real credentials).')
}
finally {
  await mf.dispose()
}
