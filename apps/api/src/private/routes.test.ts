import { sha256Bytes } from '@md/shared/utils/private-sync'
import { sign } from 'hono/jwt'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { storeAsset } from './assets'
import app from './index'
import { commitArticle } from './repository'
import { GitFixture, testArticle, testEnv } from './test-fixtures'

let git: GitFixture
beforeEach(() => { git = new GitFixture(); vi.stubGlobal('fetch', git.fetch) })
afterEach(() => vi.unstubAllGlobals())
it('protectsAssetReadsAndNeverCachesAuthorizedResponsesOr304', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const asset = await storeAsset(testEnv, `assets/${await sha256Bytes(bytes)}.png`, bytes.buffer)
  const article = { ...testArticle(), assets: [asset] }
  const result = await commitArticle(testEnv, { article, baseRevision: null, operationId: crypto.randomUUID() })
  const session = await sign({ aud: testEnv.APP_ORIGIN, sub: '123', login: 'owner', csrf: 'test', exp: Math.floor(Date.now() / 1000) + 60 }, testEnv.SESSION_SECRET, 'HS256')
  const headers = { cookie: `__Host-yanhui-session=${session}` }
  const url = `${testEnv.APP_ORIGIN}/api/${asset.path}?head=${result.head}`
  expect((await app.request(url, {}, testEnv)).status).toBe(401)
  const image = await app.request(url, { headers }, testEnv)
  expect(image.status).toBe(200)
  expect(image.headers.get('cache-control')).toBe('no-store')
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes)
  const vault = await app.request(`${testEnv.APP_ORIGIN}/api/vault`, { headers: { ...headers, 'if-none-match': `"${result.head}"` } }, testEnv)
  expect(vault.status).toBe(304)
  expect(vault.headers.get('cache-control')).toBe('no-store')
})
it('blobUploadFailureNeverAdvancesThePublishedBranch', async () => {
  const head = git.head
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({}, { status: 503 }) : git.fetch(url, init))
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  await expect(storeAsset(testEnv, `assets/${await sha256Bytes(bytes)}.png`, bytes.buffer)).rejects.toThrow()
  expect(git.head).toBe(head)
})
