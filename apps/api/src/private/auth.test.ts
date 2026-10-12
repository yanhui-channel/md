import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from './index'

const origin = 'https://editor.example'
const env = {
  APP_ORIGIN: origin,
  ALLOWED_GITHUB_USER_ID: '123',
  DATA_REPO_OWNER: 'owner',
  DATA_REPO_NAME: 'articles',
  DATA_REPO_BRANCH: 'main',
  GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'fake-client-secret',
  DATA_REPO_TOKEN: 'fake-repo-token',
  SESSION_SECRET: 'test-only-signing-secret-at-least-32-chars',
  ASSETS: { fetch: async () => new Response('shell') },
}
let githubId = 123
const cookies = (r: Response) => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
async function login() {
  const start = await app.request(`${origin}/api/auth/github`, {}, env)
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!
  const response = await app.request(`${origin}/api/auth/github/callback?code=ok&state=${state}`, { headers: { cookie: cookies(start) } }, env)
  return { start, response, cookie: cookies(response) }
}

beforeEach(() => {
  githubId = 123
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: 'fake-oauth-user-token' })
    if (input === 'https://api.github.com/user')
      return Response.json({ id: githubId, login: 'owner' })
    if (input === 'https://api.github.com/repos/owner/articles')
      return Response.json({ id: 456, private: true, permissions: { push: true } })
    throw new Error(`Unexpected test URL ${input}`)
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('owner-only private auth', () => {
  it('rejectsOtherGithubId', async () => {
    githubId = 999
    const { response, cookie } = await login()
    expect(response.status).toBe(403)
    expect((await app.request(`${origin}/api/me`, { headers: { cookie } }, env)).status).toBe(401)
  })
  it('rejectsForgedStateAndOrigin', async () => {
    expect((await app.request(`${origin}/api/auth/github/callback?code=ok&state=forged`, {}, env)).status).toBe(400)
    const { cookie } = await login()
    const me = await (await app.request(`${origin}/api/me`, { headers: { cookie } }, env)).json() as { csrfToken: string }
    const invalidHeaders: Record<string, string>[] = [{ cookie, 'origin': 'https://evil.example', 'x-csrf-token': me.csrfToken }, { cookie, origin }]
    for (const headers of invalidHeaders)
      expect((await app.request(`${origin}/api/logout`, { method: 'POST', headers }, env)).status).toBe(403)
    const logout = await app.request(`${origin}/api/logout`, { method: 'POST', headers: { cookie, origin, 'x-csrf-token': me.csrfToken } }, env)
    expect(logout.status).toBe(200)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await app.request(`${origin}/api/me`, {}, env)).status).toBe(401)
  })
  it('sessionExpiresAfterSevenDays', async () => {
    vi.useFakeTimers()
    const { cookie } = await login()
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1)
    expect((await app.request(`${origin}/api/me`, { headers: { cookie } }, env)).status).toBe(401)
  })
  it('expiresOauthStateAfterTenMinutes', async () => {
    vi.useFakeTimers()
    const start = await app.request(`${origin}/api/auth/github`, {}, env)
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    vi.setSystemTime(Date.now() + 600_001)
    expect((await app.request(`${origin}/api/auth/github/callback?code=x&state=${state}`, { headers: { cookie: cookies(start) } }, env)).status).toBe(400)
  })
  it('neverReturnsGithubToken', async () => {
    const { start, response, cookie } = await login()
    expect(response.status).toBe(302)
    expect(new URL(start.headers.get('location')!).searchParams.get('scope')).toBe('read:user')
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(response.headers.get('set-cookie')).toMatch(/Secure/)
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/)
    const me = await app.request(`${origin}/api/me`, { headers: { cookie } }, env)
    const body = await me.text()
    expect(JSON.parse(body)).toMatchObject({ ownerId: '123', login: 'owner', vaultId: '456:main' })
    expect(body + JSON.stringify([...response.headers])).not.toMatch(/fake-oauth-user-token|fake-repo-token|fake-client-secret/)
    expect(me.headers.get('cache-control')).toBe('no-store')
  })
  it('doesNotExposeUpstreamRoutes', async () => {
    for (const path of ['/upload', '/cgi-bin/stable_token', '/s/private', '/api/unknown']) {
      const result = await app.request(`${origin}${path}`, {}, env)
      expect([401, 404]).toContain(result.status)
      expect(await result.text()).not.toContain('shell')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('failsClosedWithoutConfig', async () => {
    expect((await app.request(`${origin}/api/auth/github`, {}, { ...env, SESSION_SECRET: '' })).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['DATA_REPO_OWNER', 'DATA_REPO_NAME', 'DATA_REPO_BRANCH'] as const)('rejects missing %s before OAuth starts', async (field) => {
    for (const value of [undefined, null, '', 123]) {
      const result = await app.request(`${origin}/api/auth/github`, {}, { ...env, [field]: value })
      expect(result.status).toBe(503)
      expect(result.headers.has('location')).toBe(false)
    }
  })
})
