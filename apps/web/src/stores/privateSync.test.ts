// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrivateSyncError } from '@/services/private-sync/client'
import { usePrivateSyncStore } from './privateSync'

const mocks = vi.hoisted(() => ({ me: vi.fn(), options: null as any, pause: vi.fn(), dispose: vi.fn(), sync: vi.fn(), notifySaved: vi.fn(), metadata: new Map(), source: 'saved', css: '', persist: vi.fn(), posts: [] as any[] }))
vi.mock('@/services/account/config', () => ({ PRIVATE_SYNC_ENABLED: true }))
vi.mock('@/services/private-sync/client', async (original) => {
  const actual = await original<typeof import('@/services/private-sync/client')>()
  return { ...actual, PrivateSyncClient: class { me = mocks.me; readVault = async () => ({ state: { vaultId: '123:main', head: null, entries: [] } }) } }
})
vi.mock('@/services/private-sync/coordinator', () => ({ createPrivateSyncCoordinator: (_client: unknown, options: any) => {
  mocks.options = options
  return { pause: mocks.pause, dispose: mocks.dispose, syncNow: mocks.sync, notifySaved: mocks.notifySaved }
} }))
vi.mock('@/storage/db', () => ({ getMeta: async (key: string) => mocks.metadata.get(key), setMeta: async (key: string, value: string) => mocks.metadata.set(key, value), getDatabase: async () => ({}) }))
vi.mock('@/storage/repositories/private-sync', () => ({ listSyncRecords: async () => [] }))
vi.mock('@/storage/manager', () => ({ store: {} }))
vi.mock('@/storage/repositories/documents', () => ({ isUsingLegacyDocumentStorage: () => false }))
vi.mock('@/storage/repositories/private-document-writes', () => ({}))
vi.mock('@/lib/visual/capture-theme', () => ({}))
vi.mock('./post', () => ({ usePostStore: () => ({ posts: mocks.posts, persistImmediately: mocks.persist }) }))
vi.mock('./editor', () => ({ useEditorStore: () => ({ getContent: () => mocks.source, flushContentToPostStore: () => {} }) }))
vi.mock('./theme', () => ({ useThemeStore: () => ({ $state: {} }) }))
vi.mock('./cssEditor', () => ({ useCssEditorStore: () => ({ getCurrentTabContent: () => mocks.css }) }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.metadata.clear(); mocks.source = 'saved'; mocks.css = ''; setActivePinia(createPinia())
  mocks.persist.mockResolvedValue(undefined)
  mocks.me.mockResolvedValue({ ownerId: '1', login: 'owner', vaultId: '123:main', csrfToken: 'csrf' })
})
afterEach(() => { usePrivateSyncStore().$dispose() })
it.each(['source', 'css'] as const)('inputDuringPersistenceCannotBeAcknowledgedAsSaved: %s', async (field) => {
  const sync = usePrivateSyncStore()
  mocks.persist.mockImplementationOnce(async () => { mocks[field] = 'new input during save' })
  await expect(sync.save()).rejects.toThrow('local_conflict')
  expect(mocks[field]).toBe('new input during save')
  await expect(sync.save()).resolves.toBeUndefined()
})
it('offlineStartupReconnectsOnNetworkRecoveryButExplicitPauseDoesNot', async () => {
  const sync = usePrivateSyncStore()
  mocks.me.mockRejectedValueOnce(new PrivateSyncError('network_unavailable'))
  await sync.initialize()
  window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(sync.identity?.login).toBe('owner'))
  sync.pause()
  const calls = mocks.me.mock.calls.length
  window.dispatchEvent(new Event('online'))
  document.dispatchEvent(new Event('visibilitychange'))
  await Promise.resolve()
  expect(mocks.me).toHaveBeenCalledTimes(calls)
})
it('historyOnlySaveDoesNotResetTheSyncIdleTimer', async () => {
  const sync = usePrivateSyncStore()
  await sync.initialize()
  mocks.notifySaved.mockClear()
  window.dispatchEvent(new CustomEvent('md:private-saved', { detail: { id: 'a', historyOnly: true } }))
  expect(mocks.notifySaved).not.toHaveBeenCalled()
  window.dispatchEvent(new CustomEvent('md:private-saved', { detail: { id: 'a', historyOnly: false } }))
  expect(mocks.notifySaved).toHaveBeenCalledExactlyOnceWith('a')
})
it('manualSyncWaitsForStartupAndExplicitPauseStopsStartupAutoSync', async () => {
  const sync = usePrivateSyncStore()
  let ready!: (identity: any) => void
  mocks.me.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve }))
  const initial = sync.initialize()
  sync.pause()
  const manual = sync.syncNow()
  ready({ ownerId: '1', login: 'owner', vaultId: '123:main', csrfToken: 'csrf' })
  await initial; await manual
  expect(mocks.sync).toHaveBeenCalledTimes(1)
})
it('expiredSessionShowsLoginAndReconnectsWithoutSendingWhileUnauthenticated', async () => {
  const sync = usePrivateSyncStore()
  await sync.initialize()
  mocks.options.onChange('attention', 'login_required')
  expect(sync.identity).toBeNull()
  expect(sync.paused).toBe(true)
  mocks.me.mockRejectedValueOnce(new PrivateSyncError('login_required', 401))
  await sync.syncNow()
  expect(mocks.sync).not.toHaveBeenCalled()
  await sync.syncNow()
  expect(sync.identity?.login).toBe('owner')
  expect(mocks.sync).toHaveBeenCalledTimes(1)
})
