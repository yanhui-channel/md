// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'

const state = vi.hoisted(() => ({ folder: null as any, post: null as any, disk: new Map<string, string>(), cleanup: () => {} }))
vi.mock('@/stores/folderSource', () => ({ useFolderSourceStore: () => state.folder }))
vi.mock('@/stores/post', () => ({ usePostStore: () => state.post }))
const { useFolderFileSync } = await import('./useFolderFileSync')
let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('onBeforeUnmount', (cleanup: () => void) => { state.cleanup = cleanup })
  state.disk = new Map([['drafts/a.md', 'before']])
  state.post = reactive({ currentPostId: 'a', currentPost: { content: 'before' } })
  state.folder = reactive({
    isLoading: false,
    needsPermission: false,
    loadError: '',
    currentFolderHandle: { handle: { name: 'drafts' } },
    async writeFile(path: string, content: string) {
      if (!state.folder.currentFolderHandle)
        throw new Error('disconnected')
      state.disk.set(path, content)
    },
  })
  scope = effectScope()
})
afterEach(() => {
  state.cleanup()
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['refresh', 'canceled picker', 'failed forget'])('retains pending saves across %s', async (operation) => {
  const sync = scope.run(() => useFolderFileSync())!
  const original = state.folder.currentFolderHandle
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPost.content = 'latest'
  await nextTick()
  state.folder.isLoading = true
  if (operation === 'refresh')
    state.folder.currentFolderHandle = null
  await nextTick()
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.disk.get('drafts/a.md')).toBe('before')
  state.folder.currentFolderHandle = original
  state.folder.isLoading = false
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.disk.get('drafts/a.md')).toBe('latest')
})

it('never writes a pending edit into a newly connected folder', async () => {
  const sync = scope.run(() => useFolderFileSync())!
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPost.content = 'latest'
  await nextTick()
  state.folder.isLoading = true
  await nextTick()
  state.folder.currentFolderHandle = { handle: { name: 'other-folder' } }
  state.folder.isLoading = false
  await nextTick()
  await vi.advanceTimersByTimeAsync(1500)
  expect(sync.currentFilePath.value).toBeNull()
  expect(state.disk.get('drafts/a.md')).toBe('before')
})

it('keeps pending content through a denied reconnect and a successful retry', async () => {
  const sync = scope.run(() => useFolderFileSync())!
  const original = state.folder.currentFolderHandle
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPost.content = 'latest'
  await nextTick()
  state.folder.isLoading = true
  state.folder.currentFolderHandle = null
  state.folder.needsPermission = true
  state.folder.isLoading = false
  await vi.advanceTimersByTimeAsync(1500)
  expect(sync.currentFilePath.value).toBe('drafts/a.md')
  expect(state.disk.get('drafts/a.md')).toBe('before')
  state.post.currentPost.content = 'edited while disconnected'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1500)
  state.folder.isLoading = true
  state.folder.needsPermission = false
  state.folder.currentFolderHandle = original
  state.folder.isLoading = false
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.disk.get('drafts/a.md')).toBe('edited while disconnected')
})

it('does not requeue a failed write after rebinding the same path in another folder', async () => {
  const sync = scope.run(() => useFolderFileSync())!
  let rejectWrite!: (reason: Error) => void
  state.folder.writeFile = vi.fn()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject }))
    .mockImplementation(async (path: string, content: string) => { state.disk.set(path, content) })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPost.content = 'old folder content'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)
  state.folder.currentFolderHandle = { handle: { name: 'drafts' } }
  sync.setCurrentFilePath('drafts/a.md')
  rejectWrite(new Error('permission revoked'))
  await nextTick()
  state.folder.isLoading = true
  state.folder.isLoading = false
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.folder.writeFile).toHaveBeenCalledTimes(1)
  expect(state.disk.get('drafts/a.md')).toBe('before')
  log.mockRestore()
})

it('switching articles cannot overwrite the opened local file', async () => {
  const sync = scope.run(() => useFolderFileSync())!
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPostId = 'b'
  state.post.currentPost.content = 'different article'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.disk.get('drafts/a.md')).toBe('before')
})

it('does not retry an old failed write over a newer successful save', async () => {
  const sync = scope.run(() => useFolderFileSync())!
  let rejectWrite!: (reason: Error) => void
  state.folder.writeFile = vi.fn()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject }))
    .mockImplementation(async (path: string, content: string) => { state.disk.set(path, content) })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  sync.setCurrentFilePath('drafts/a.md')
  state.post.currentPost.content = 'older'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)
  state.post.currentPost.content = 'newer'
  await nextTick()
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.disk.get('drafts/a.md')).toBe('newer')
  rejectWrite(new Error('earlier request failed'))
  await nextTick()
  state.folder.isLoading = true
  state.folder.isLoading = false
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.disk.get('drafts/a.md')).toBe('newer')
  log.mockRestore()
})
