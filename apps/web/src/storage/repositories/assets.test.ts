import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assetRepo } from './assets'

const db = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }))
vi.mock('@/storage/db', () => ({ getDatabase: async () => db }))
vi.mock('@/storage/repositories/documents', () => ({ isUsingLegacyDocumentStorage: () => false }))
const png = () => new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'image.png', { type: 'image/png' })
beforeEach(() => {
  const rows = new Map()
  db.put.mockReset().mockImplementation(async (_store, value) => { rows.set(value.path, value) })
  db.get.mockReset().mockImplementation(async (_store, key) => rows.get(key))
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close() {} }))
})
afterEach(() => vi.unstubAllGlobals())

describe('local assets', () => {
  it('duplicateBytesReusePath and stored bytes are unchanged', async () => {
    const file = png()
    const first = await assetRepo.put(file)
    expect(first.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/)
    expect((await assetRepo.put(file)).path).toBe(first.path)
    expect(await (await assetRepo.get(first.path))?.blob.arrayBuffer()).toEqual(await file.arrayBuffer())
  })
  it('quotaFailureDoesNotReturnAReference', async () => {
    db.put.mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    await expect(assetRepo.put(png())).rejects.toThrow('Full')
  })
  it('rejects invalid and oversized bytes before storing', async () => {
    await expect(assetRepo.put(new File(['not png'], 'bad.png', { type: 'image/png' }))).rejects.toThrow()
    const file = png()
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 })
    await expect(assetRepo.put(file)).rejects.toThrow()
    expect(db.put).not.toHaveBeenCalled()
  })
  it('rejects a valid signature when actual image decoding fails', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode failed'))
    await expect(assetRepo.put(png())).rejects.toThrow()
    expect(db.put).not.toHaveBeenCalled()
  })
})
