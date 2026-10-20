import { afterEach, expect, it, vi } from 'vitest'
import { PrivateSyncClient } from './client'

afterEach(() => vi.unstubAllGlobals())
it('usesOnlySameOriginCookiesAndInMemoryCsrf', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ownerId: '1', login: 'owner', vaultId: '1:main', csrfToken: 'csrf' })).mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const client = new PrivateSyncClient()
  await client.me(); await client.logout()
  expect(fetch).toHaveBeenLastCalledWith('/api/logout', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-csrf-token': 'csrf' } }))
})
it('preservesRetryAfterAndSupports304', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '120' } })).mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"head"' } })))
  const client = new PrivateSyncClient()
  await expect(client.readVault()).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 120000 })
  expect(await client.readVault('"head"')).toEqual({ state: null, etag: '"head"' })
})
it('bindsBothWriteEndpointsToTheExplicitVault', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'vault_changed' }, { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  const client = new PrivateSyncClient()
  await expect(client.commitArticle({ article: { id: 'a' } } as any, '123:main')).rejects.toMatchObject({ code: 'vault_changed' })
  await expect(client.uploadAsset({ path: 'assets/image.png', mime: 'image/png' } as any, new Blob(['image']), '123:main')).rejects.toMatchObject({ code: 'vault_changed' })
  expect(fetch.mock.calls.map((call: any) => call[1].headers['x-vault-id'])).toEqual(['123:main', '123:main'])
})
