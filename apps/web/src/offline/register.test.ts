// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, expect, it, vi } from 'vitest'
import { activatePrivateUpdate } from './register'

const mocks = vi.hoisted(() => ({ save: vi.fn(async () => {}), composing: false }))
vi.mock('@/stores/privateSync', () => ({ usePrivateSyncStore: () => ({ save: mocks.save, pause: vi.fn() }) }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => ({ visualSession: { isComposing: () => mocks.composing } }) }))
vi.mock('@/i18n/translate', () => ({ t: (s: string) => s }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.composing = false })
function worker() {
  const handlers: Record<string, (e: any) => void> = {}
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => new Response('cached')) }
  const self = { location: { origin: 'https://editor.test' }, addEventListener: (event: string, fn: (e: any) => void) => { handlers[event] = fn }, clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [{ postMessage: vi.fn() }]) }, skipWaiting: vi.fn() }
  const source = readFileSync(path.resolve('public/private-sw.js'), 'utf8').replace('= __PRIVATE_MANIFEST__', `= ${JSON.stringify({ version: 'test', files: ['/index.html', '/static/app.js'] })}`)
  const indexedDB = { deleteDatabase: vi.fn() }
  class BrowserRequest extends Request {
    constructor(url: string, init: RequestInit) { super(new URL(url, 'https://editor.test').href, init) }
  }
  vm.runInNewContext(source, { ...self, URL, Request: BrowserRequest, Response, indexedDB, caches: { open: async () => cache, match: cache.match, delete: vi.fn() }, fetch: vi.fn() })
  return { handlers, cache, self, indexedDB }
}
it('neverCachesAuthOrPrivateApi', () => {
  const { handlers } = worker()
  for (const url of ['/api/me', '/api/auth/github/callback?code=secret', '/api/assets/a.png', '/assets/private.png', 'https://other.test/static/app.js']) {
    const respondWith = vi.fn()
    handlers.fetch({ request: { url: new URL(url, 'https://editor.test').href, method: 'GET', mode: 'navigate' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  }
})
it('offlineReadyRequiresAllCoreAssets', async () => {
  const { handlers, cache, self } = worker()
  cache.addAll.mockRejectedValueOnce(new Error('quota'))
  let job!: Promise<unknown>
  handlers.install({ waitUntil: (p: Promise<unknown>) => { job = p } })
  await expect(job).rejects.toThrow('quota')
  expect(self.skipWaiting).not.toHaveBeenCalled()
  expect(self.clients.matchAll).not.toHaveBeenCalled()
})
it('doesNotClearIndexedDbOnActivate', async () => {
  const { handlers, indexedDB, self } = worker()
  let job!: Promise<unknown>
  handlers.activate({ waitUntil: (p: Promise<unknown>) => { job = p } })
  await job
  expect(indexedDB.deleteDatabase).not.toHaveBeenCalled()
  expect(self.clients.claim).toHaveBeenCalled()
})
it('updateWaitsForSavedComposition', async () => {
  vi.useFakeTimers(); mocks.composing = true
  const waiting = { postMessage: vi.fn() }
  const update = activatePrivateUpdate(waiting as unknown as ServiceWorker)
  await vi.advanceTimersByTimeAsync(100)
  expect(mocks.save).not.toHaveBeenCalled()
  expect(waiting.postMessage).not.toHaveBeenCalled()
  mocks.composing = false
  await vi.advanceTimersByTimeAsync(50); await update
  expect(mocks.save).toHaveBeenCalledTimes(1)
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE' })
  mocks.save.mockRejectedValueOnce(new Error('quota'))
  await expect(activatePrivateUpdate(waiting as unknown as ServiceWorker)).rejects.toThrow('quota')
  expect(waiting.postMessage).toHaveBeenCalledTimes(1)
})
