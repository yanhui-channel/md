// @vitest-environment jsdom
import type { CommitArticleRequest } from '@md/shared/types/private-sync'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrivateSyncError } from './client'
import { createPrivateSyncCoordinator } from './coordinator'

const state = vi.hoisted(() => ({ record: {} as any, pending: null as any, metadata: new Map<string, string>() }))
vi.mock('@/storage/db', () => ({ getMeta: async (key: string) => state.metadata.get(key) ?? null, setMeta: async (key: string, value: string) => { state.metadata.set(key, value) } }))
vi.mock('@/storage/repositories/private-sync', () => ({
  listSyncRecords: async () => [{ id: 'a', record: state.record }],
  preparePending: async () => state.record.selected ? state.pending : null,
  getSyncRecord: async () => state.record,
  getLocalDraft: async () => ({ generation: state.record.localGeneration }),
  confirmPending: vi.fn(async (_v, _id, generation) => { state.record.confirmedGeneration = generation; state.pending = null }),
  rememberConflict: vi.fn(async (_v, _id, conflict) => { state.record.conflict = conflict }),
  applyRemote: vi.fn(),
}))
vi.mock('@/storage/repositories/assets', () => ({ assetRepo: { get: vi.fn() }, validateAsset: vi.fn() }))

const coordinators: ReturnType<typeof createPrivateSyncCoordinator>[] = []
function setup() {
  const client = {
    readVault: vi.fn(async () => ({ state: { vaultId: '1:main', head: 'a'.repeat(40), entries: [] }, etag: 'a' })),
    commitArticle: vi.fn(async (request: CommitArticleRequest) => ({ head: 'b'.repeat(40), stored: { article: request.article, revision: request.operationId, operationId: request.operationId, digest: 'x' } })),
    uploadAsset: vi.fn(),
    readArticle: vi.fn(),
    readAsset: vi.fn(),
  }
  const options = { vaultId: '1:main', beforeSync: vi.fn(async () => {}), onChange: vi.fn(), onRemote: vi.fn(async () => {}), onVault: vi.fn() }
  const coordinator = createPrivateSyncCoordinator(client as any, options)
  coordinators.push(coordinator)
  return { client, options, coordinator }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  state.metadata.clear()
  state.record = { selected: true, localGeneration: 1, confirmedGeneration: 0, conflict: null }
  state.pending = { generation: 1, request: { operationId: 'op-1', baseRevision: null, article: { id: 'a', assets: [] } } }
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  let locked = false
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, action: (lock: unknown) => Promise<void>) => {
    if (locked)
      return action(null)
    locked = true
    try { return await action({}) }
    finally { locked = false }
  } } })
})
afterEach(() => { coordinators.splice(0).forEach(c => c.dispose()); vi.useRealTimers() })
it('autoSyncWaitsThirtySecondsAndThrottles', async () => {
  const { client, coordinator } = setup()
  coordinator.notifySaved('a')
  await vi.advanceTimersByTimeAsync(29999)
  expect(client.commitArticle).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
  state.record.localGeneration = 2
  state.pending = { generation: 2, request: { operationId: 'op-2', article: { id: 'a', assets: [] } } }
  coordinator.notifySaved('a')
  await vi.advanceTimersByTimeAsync(59999)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(client.commitArticle).toHaveBeenCalledTimes(2)
})
it('noUploadBeforeSelection', async () => {
  state.record.selected = false
  const { coordinator, client } = setup()
  await coordinator.syncNow()
  expect(client.commitArticle).not.toHaveBeenCalled()
})
it('editingDuringUploadKeepsPending', async () => {
  const { coordinator, client, options } = setup()
  client.commitArticle.mockImplementationOnce(async (request) => {
    state.record.localGeneration = 2
    return { head: 'b'.repeat(40), stored: { article: request.article, revision: request.operationId, operationId: request.operationId, digest: 'x' } }
  })
  await coordinator.syncNow()
  expect(state.record.localGeneration).toBe(2)
  expect(state.record.confirmedGeneration).toBe(1)
  expect(options.onChange).toHaveBeenLastCalledWith('local', '')
})
it('reauthDoesNotDiscardDraft', async () => {
  const { coordinator, client, options } = setup()
  client.commitArticle.mockRejectedValueOnce(new PrivateSyncError('login_required', 401))
  await coordinator.syncNow()
  coordinator.notifySaved('a')
  await vi.advanceTimersByTimeAsync(300000)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
  expect(state.pending).not.toBeNull()
  expect(options.onChange).toHaveBeenLastCalledWith('attention', 'login_required')
  const next = setup()
  await next.coordinator.syncNow()
  expect(next.client.commitArticle).toHaveBeenCalledTimes(1)
})
it('respectsRetryAfterEvenForManualSync', async () => {
  const { coordinator, client } = setup()
  client.commitArticle.mockRejectedValueOnce(new PrivateSyncError('rate_limited', 429, undefined, 120000))
  await coordinator.syncNow()
  await coordinator.syncNow()
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(119999)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
})
it('compositionDefersSyncAndLogin', async () => {
  const { coordinator, client, options } = setup()
  options.beforeSync.mockRejectedValueOnce(new Error('composition_active'))
  await coordinator.syncNow()
  expect(client.commitArticle).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
})
it('onlyOneTabSendsAndAnotherCanTakeOver', async () => {
  const a = setup(); const b = setup()
  let resume!: () => void
  a.options.beforeSync.mockImplementationOnce(() => new Promise<void>((resolve) => { resume = resolve }))
  const first = a.coordinator.syncNow()
  await vi.advanceTimersByTimeAsync(0)
  await b.coordinator.syncNow()
  expect(b.client.commitArticle).not.toHaveBeenCalled()
  resume(); await first
  a.coordinator.dispose()
  state.pending = { generation: 2, request: { operationId: 'op-2', article: { id: 'a', assets: [] } } }
  await b.coordinator.syncNow()
  expect(b.client.commitArticle).toHaveBeenCalledTimes(1)
})
it('doesNotKeepRetryingAnInvalidArticle', async () => {
  const { coordinator, client } = setup()
  client.commitArticle.mockRejectedValue(new PrivateSyncError('invalid_payload', 422))
  await coordinator.syncNow()
  await vi.advanceTimersByTimeAsync(600000)
  expect(client.commitArticle).toHaveBeenCalledTimes(1)
})
