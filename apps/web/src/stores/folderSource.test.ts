// @vitest-environment jsdom
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'

let useFolderSourceStore: typeof import('./folderSource')['useFolderSourceStore']

const disk = vi.hoisted(() => ({ rows: new Map<string, any>(), fail: false }))
vi.mock('@/storage/db', () => ({
  getDatabase: async () => {
    if (disk.fail)
      throw new Error('storage unavailable')
    return {
      get: async (table: string, key: string) => disk.rows.get(`${table}:${key}`),
      put: async (table: string, row: any) => disk.rows.set(`${table}:${row.id}`, row),
      delete: async (table: string, key: string) => disk.rows.delete(`${table}:${key}`),
    }
  },
}))
vi.mock('@/i18n/translate', () => ({ t: (key: string, args?: { message?: string }) => `${key}${args?.message ?? ''}` }))

function directory(name = 'drafts', permission: PermissionState = 'granted') {
  return {
    name,
    kind: 'directory',
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    values: vi.fn(async function* () {
      yield { name: 'article.md', kind: 'file' }
      yield { name: 'photo.png', kind: 'file' }
    }),
    getFileHandle: vi.fn(),
    getDirectoryHandle: vi.fn(),
    removeEntry: vi.fn(),
  } as unknown as FileSystemDirectoryHandle
}

function freshStore() {
  setActivePinia(createPinia())
  return useFolderSourceStore()
}

beforeEach(async () => {
  disk.rows.clear()
  disk.fail = false
  vi.stubGlobal('defineStore', defineStore)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('toast', { error: vi.fn(), success: vi.fn() })
  vi.stubGlobal('showDirectoryPicker', vi.fn())
  useFolderSourceStore = (await import('./folderSource')).useFolderSourceStore
})
afterEach(() => vi.unstubAllGlobals())

it('remembers the selected directory across store recreation without writing files', async () => {
  const handle = directory()
  vi.mocked(window.showDirectoryPicker).mockResolvedValue(handle)
  await freshStore().selectFolder()
  expect(disk.rows.size).toBe(1)
  const reopened = freshStore()
  await reopened.restoreLastFolder()
  expect(reopened.currentFolderHandle?.name).toBe('drafts')
  expect(reopened.getAllMarkdownFiles().map(node => node.path)).toEqual(['drafts/article.md'])
  expect(handle.getFileHandle).not.toHaveBeenCalled()
  expect(handle.removeEntry).not.toHaveBeenCalled()
})

it.each(['prompt', 'denied'] as PermissionState[])('keeps the folder visible without prompting on startup: %s', async (permission) => {
  const handle = directory('drafts', permission)
  disk.rows.set('folders:last', { id: 'last', handle })
  const store = freshStore()
  await store.restoreLastFolder()
  expect(store.rememberedFolderName).toBe('drafts')
  expect(store.needsPermission).toBe(true)
  expect(store.currentFolderHandle).toBeNull()
  expect(store.fileTree).toEqual([])
  expect(handle.requestPermission).not.toHaveBeenCalled()
  expect(handle.values).not.toHaveBeenCalled()
  vi.mocked(handle.requestPermission).mockResolvedValue('granted')
  await store.reconnectFolder()
  expect(store.currentFolderHandle?.name).toBe('drafts')
  expect(store.needsPermission).toBe(false)
})

it('retains a connection after permission refusal and allows retry', async () => {
  const handle = directory('drafts', 'denied')
  disk.rows.set('folders:last', { id: 'last', handle })
  const store = freshStore()
  await store.restoreLastFolder()
  await store.reconnectFolder()
  expect(store.loadError).not.toBe('')
  expect(store.rememberedFolderName).toBe('drafts')
  expect(store.currentFolderHandle).toBeNull()
  vi.mocked(handle.requestPermission).mockResolvedValue('granted')
  await store.reconnectFolder()
  expect(store.loadError).toBe('')
  expect(store.getAllMarkdownFiles()).toHaveLength(1)
})

it('revoked access during refresh disconnects the active tree without forgetting the folder', async () => {
  const handle = directory()
  disk.rows.set('folders:last', { id: 'last', handle })
  const store = freshStore()
  await store.restoreLastFolder()
  vi.mocked(handle.requestPermission).mockResolvedValue('denied')
  await store.reconnectFolder()
  expect(store.currentFolderHandle).toBeNull()
  expect(store.fileTree).toEqual([])
  expect(store.rememberedFolderName).toBe('drafts')
})

it('a failed forget keeps the saved connection and reports failure', async () => {
  disk.rows.set('folders:last', { id: 'last', handle: directory() })
  const store = freshStore()
  await store.restoreLastFolder()
  disk.fail = true
  await store.forgetFolder()
  expect(store.rememberedFolderName).toBe('drafts')
  expect(store.persistenceError).toBeTruthy()
  disk.fail = false
  await store.forgetFolder()
  expect(store.rememberedFolderName).toBe('')
})

it('forget removes only the connection and does not restore it on restart', async () => {
  const handle = directory()
  disk.rows.set('folders:last', { id: 'last', handle })
  disk.rows.set('documents:existing', { content: 'keep this draft' })
  const store = freshStore()
  await store.restoreLastFolder()
  await store.forgetFolder()
  expect(store.currentFolderHandle).toBeNull()
  expect(store.rememberedFolderName).toBe('')
  const reopened = freshStore()
  await reopened.restoreLastFolder()
  expect(reopened.fileTree).toEqual([])
  expect(disk.rows.get('documents:existing')).toEqual({ content: 'keep this draft' })
  expect(handle.removeEntry).not.toHaveBeenCalled()
})

it('canceling a replacement picker keeps the previous folder', async () => {
  disk.rows.set('folders:last', { id: 'last', handle: directory() })
  const store = freshStore()
  await store.restoreLastFolder()
  vi.mocked(window.showDirectoryPicker).mockRejectedValue(new DOMException('cancel', 'AbortError'))
  await store.selectFolder()
  expect(store.currentFolderHandle?.name).toBe('drafts')
  expect(store.loadError).toBe('')
  expect(store.isLoading).toBe(false)
})

it('missing or unreadable folders show a recoverable error instead of an empty success', async () => {
  const handle = directory()
  vi.mocked(handle.values).mockImplementation(async function* () {
    throw new DOMException('folder moved or deleted', 'NotFoundError')
  })
  disk.rows.set('folders:last', { id: 'last', handle })
  const store = freshStore()
  await store.restoreLastFolder()
  expect(store.loadError).toContain('folder moved or deleted')
  expect(store.rememberedFolderName).toBe('drafts')
  expect(store.currentFolderHandle).toBeNull()
  expect(store.fileTree).toEqual([])
})

it('storage failure does not prevent opening a folder but reports that it was not remembered', async () => {
  disk.fail = true
  vi.mocked(window.showDirectoryPicker).mockResolvedValue(directory())
  const store = freshStore()
  await store.selectFolder()
  expect(store.currentFolderHandle?.name).toBe('drafts')
  expect(store.persistenceError).toBeTruthy()
})

it('unsupported browsers do not try to restore or request folder access', async () => {
  Reflect.deleteProperty(window, 'showDirectoryPicker')
  disk.rows.set('folders:last', { id: 'last', handle: directory() })
  const store = freshStore()
  await store.restoreLastFolder()
  expect(store.isFileSystemAPISupported).toBe(false)
  expect(store.currentFolderHandle).toBeNull()
})
