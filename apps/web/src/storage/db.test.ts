import { expect, it } from 'vitest'
import { upgradeDB } from './db'

it('adds folder connections without changing existing article or asset stores', async () => {
  const documents = new Map([['draft', { content: 'saved article' }]])
  const assets = new Map([['image', new Uint8Array([1, 2, 3])]])
  const stores = new Map<string, unknown>([
    ['documents', documents],
    ['assets', assets],
    ['settings', new Map()],
    ['secrets', new Map()],
    ['cache', new Map()],
    ['meta', new Map()],
  ])
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      if (stores.has(name))
        throw new Error('Existing store must not be replaced')
      const rows = new Map()
      stores.set(name, rows)
      return rows
    },
  }
  await upgradeDB(db as any, 5, 6, {} as any)
  expect(stores.has('folders')).toBe(true)
  expect(stores.get('documents')).toBe(documents)
  expect(documents.get('draft')).toEqual({ content: 'saved article' })
  expect(stores.get('assets')).toBe(assets)
  expect(assets.get('image')).toEqual(new Uint8Array([1, 2, 3]))
})
