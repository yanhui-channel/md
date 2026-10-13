import { t } from '@/i18n/translate'
import { DB_NAME } from '@/storage/keys'

const confirmation = 'private:clear-confirmed'
export function openLocalCleanup() {
  sessionStorage.setItem(confirmation, '1')
  window.location.assign('/?clear-local=1')
}

export async function handleLocalCleanup(): Promise<boolean> {
  if (!new URL(location.href).searchParams.has('clear-local') || sessionStorage.getItem(confirmation) !== '1')
    return false
  // A fresh document has no editor watchers or pending autosaves that could recreate data.
  document.getElementById('app-initial-loader')?.remove()
  const screen = document.createElement('main')
  screen.style.cssText = 'max-width:540px;margin:80px auto;padding:24px;font:16px/1.8 system-ui;color:#202124'
  const message = document.createElement('p')
  message.setAttribute('role', 'status')
  const button = document.createElement('button')
  button.style.cssText = 'padding:8px 16px;border:1px solid #d1d5db;border-radius:4px;background:white;color:#202124'
  screen.append(message, button)
  document.getElementById('app')!.replaceChildren(screen)
  async function clear() {
    button.disabled = true
    try {
      const worker = navigator.serviceWorker?.controller
      if (!worker)
        throw new Error('closeOtherTabs')
      const count = await new Promise<number>((resolve, reject) => {
        const channel = new MessageChannel()
        const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('closeOtherTabs')) }, 5000)
        channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); resolve(event.data) }
        worker.postMessage({ type: 'COUNT_WINDOWS' }, [channel.port2])
      })
      if (count !== 1)
        throw new Error('closeOtherTabs')
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      localStorage.clear()
      sessionStorage.clear()
      for (const name of await caches.keys()) {
        if (name.startsWith('yanhui-private-shell-'))
          await caches.delete(name)
      }
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister()
      message.textContent = t('privateSync.cleared')
      button.textContent = t('privateSync.reopen')
      button.onclick = () => window.location.replace('/')
    }
    catch (error) {
      message.textContent = t(error instanceof Error && error.message === 'closeOtherTabs' ? 'privateSync.closeOtherTabs' : 'privateSync.clearFailed')
      button.textContent = t('privateSync.retryClear')
      button.onclick = () => { void clear() }
    }
    finally { button.disabled = false }
  }
  await clear()
  return true
}
