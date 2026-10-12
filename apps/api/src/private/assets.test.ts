import { Buffer } from 'node:buffer'
import { sha256Bytes } from '@md/shared/utils/private-sync'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { storeAsset } from './assets'
import { commitArticle } from './repository'
import { GitFixture, testArticle, testEnv } from './test-fixtures'

let git: GitFixture
beforeEach(() => { git = new GitFixture(); vi.stubGlobal('fetch', git.fetch) })
afterEach(() => vi.unstubAllGlobals())
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8l8AAAAASUVORK5CYII=', 'base64'))

it('validatesAssetAndPublishesItWithArticle', async () => {
  const path = `assets/${await sha256Bytes(png)}.png`
  const oldHead = git.head
  const asset = await storeAsset(testEnv, '456:main', path, png.buffer)
  expect(git.head).toBe(oldHead)
  expect(asset).toMatchObject({ path, mime: 'image/png', size: png.length })
  const article = testArticle()
  article.assets = [asset]
  article.markdown = `![photo](${path})`
  await commitArticle(testEnv, '456:main', { article, baseRevision: null, operationId: crypto.randomUUID() })
  expect(git.files()[path]).toBe(asset.blobSha)
})
it('rejectsWrongHashFakeMimeOversizeAndUnresolvedBlob', async () => {
  const path = `assets/${await sha256Bytes(png)}.png`
  await expect(storeAsset(testEnv, '456:main', `assets/${'0'.repeat(64)}.png`, png.buffer)).rejects.toMatchObject({ status: 422 })
  await expect(storeAsset(testEnv, '456:main', path.replace('.png', '.jpg'), png.buffer)).rejects.toMatchObject({ status: 422 })
  await expect(storeAsset(testEnv, '456:main', path, new ArrayBuffer(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
  const asset = await storeAsset(testEnv, '456:main', path, png.buffer)
  const article = testArticle()
  article.assets = [{ ...asset, blobSha: 'f'.repeat(40) }]
  const oldHead = git.head
  await expect(commitArticle(testEnv, '456:main', { article, baseRevision: null, operationId: crypto.randomUUID() })).rejects.toThrow()
  expect(git.head).toBe(oldHead)
})

it('commitsManyVerifiedImagesWithoutExceedingTheFreeWorkerRequestBudget', async () => {
  const article = testArticle()
  for (let i = 0; i < 60; i++) {
    const bytes = new Uint8Array([...png, i])
    article.assets.push(await storeAsset(testEnv, '456:main', `assets/${await sha256Bytes(bytes)}.png`, bytes.buffer))
  }
  const requests = vi.fn(git.fetch)
  vi.stubGlobal('fetch', requests)
  await commitArticle(testEnv, '456:main', { article, baseRevision: null, operationId: crypto.randomUUID() })
  expect(requests.mock.calls.length).toBeLessThan(40)
})

it('rejectsForgedOrCrossVaultUploadReceipts', async () => {
  const path = `assets/${await sha256Bytes(png)}.png`
  const asset = await storeAsset(testEnv, '456:main', path, png.buffer)
  const input = { article: { ...testArticle(), assets: [{ ...asset, size: asset.size + 1 }] }, baseRevision: null, operationId: crypto.randomUUID() }
  await expect(commitArticle(testEnv, '456:main', input)).rejects.toThrow()
  input.article.assets = [asset]
  await expect(commitArticle({ ...testEnv, SESSION_SECRET: 'another-valid-secret-with-32-characters' }, '456:main', input)).rejects.toThrow()
})
