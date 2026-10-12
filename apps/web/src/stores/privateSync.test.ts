// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { PrivateSyncError } from '@/services/private-sync/client'
import { usePrivateSyncStore } from './privateSync'

const mocks = vi.hoisted(() => ({ me: vi.fn(), options: null as any, pause: vi.fn(), dispose: vi.fn(), sync: vi.fn(), metadata: new Map() }))
vi.mock('@/services/account/config', () => ({ PRIVATE_SYNC_ENABLED: true }))
vi.mock('@/services/private-sync/client', async (original) => {
  const actual = await original<typeof import('@/services/private-sync/client')>()
  return { ...actual, PrivateSyncClient: class { me = mocks.me; readVault = async () => ({ state: { vaultId: '123:main', head: null, entries: [] } }) } }
})
vi.mock('@/services/private-sync/coordinator', () => ({ createPrivateSyncCoordinator: (_client: unknown, options: any) => {
  mocks.options = options
  return { pause: mocks.pause, dispose: mocks.dispose, syncNow: mocks.sync, notifySaved: vi.fn() }
} }))
vi.mock('@/storage/db', () => ({ getMeta: async (key: string) => mocks.metadata.get(key), setMeta: async (key: string, value: string) => mocks.metadata.set(key, value), getDatabase: async () => ({}) }))
vi.mock('@/storage/repositories/private-sync', () => ({ listSyncRecords: async () => [] }))
vi.mock('@/storage/manager', () => ({ store: {} }))
vi.mock('@/storage/repositories/documents', () => ({}))
vi.mock('@/storage/repositories/private-document-writes', () => ({}))
vi.mock('@/lib/visual/capture-theme', () => ({}))
vi.mock('./post', () => ({}))
vi.mock('./editor', () => ({}))
vi.mock('./theme', () => ({}))
beforeEach(() => {
  vi.clearAllMocks(); mocks.metadata.clear(); setActivePinia(createPinia())
  mocks.me.mockResolvedValue({ ownerId: '1', login: 'owner', vaultId: '123:main', csrfToken: 'csrf' })
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
