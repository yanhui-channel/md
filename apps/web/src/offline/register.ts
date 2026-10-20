import { ref } from 'vue'
import { t } from '@/i18n/translate'
import { toast } from '@/lib/toast'
import { saveBeforeNavigation } from '@/services/private-sync/navigation'
import { useEditorStore } from '@/stores/editor'
import { usePrivateSyncStore } from '@/stores/privateSync'

export const offlineState = ref<'preparing' | 'ready' | 'unavailable'>('preparing')
export const persistentStorage = ref(false)
export const waitingUpdate = ref<ServiceWorker | null>(null)
let reloadRequested = false
function isComposing() { return !!(useEditorStore().visualSession?.isComposing() || useEditorStore().editor?.composing) }
export async function activatePrivateUpdate(worker: ServiceWorker): Promise<void> {
  const sync = usePrivateSyncStore()
  sync.pause()
  await saveBeforeNavigation(isComposing, sync.save, () => {
    reloadRequested = true
    worker.postMessage({ type: 'ACTIVATE_UPDATE' })
  })
}
export async function registerPrivateOffline(): Promise<void> {
  if (!import.meta.env.PROD || import.meta.env.VITE_PRIVATE_SYNC_ENABLED !== 'true')
    return
  if (!('serviceWorker' in navigator)) { offlineState.value = 'unavailable'; return }
  try {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OFFLINE_READY')
        offlineState.value = 'ready'
      if (event.data?.type === 'OFFLINE_INCOMPLETE')
        offlineState.value = 'unavailable'
      if (event.data?.type === 'UPDATE_READY')
        void navigator.serviceWorker.getRegistration().then((r) => { waitingUpdate.value = r?.waiting ?? null })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      navigator.serviceWorker.controller?.postMessage({ type: 'CHECK_OFFLINE' })
      if (reloadRequested) {
        reloadRequested = false
        void saveBeforeNavigation(isComposing, usePrivateSyncStore().save, () => window.location.reload()).catch(() => toast.error(t('privateSync.exportFirst')))
      }
    })
    const registration = await navigator.serviceWorker.register('/private-sw.js', { scope: '/', updateViaCache: 'none' })
    waitingUpdate.value = registration.waiting
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller)
          waitingUpdate.value = registration.waiting
        if (installing.state === 'redundant')
          offlineState.value = 'unavailable'
      })
    })
    navigator.serviceWorker.controller?.postMessage({ type: 'CHECK_OFFLINE' })
    persistentStorage.value = await navigator.storage?.persist?.().catch(() => false) ?? false
  }
  catch { offlineState.value = 'unavailable' }
}
