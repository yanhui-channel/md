import { initComponentDarkVars } from '@md/core/theme'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { detectInitialLocale } from '@/i18n/detect'
import { setAppI18n, setupI18n } from '@/i18n/index'
import { t } from '@/i18n/translate'
import { initStorage } from '@/storage'
import { useLocaleStore } from '@/stores/locale'
import { installYanhuiTrial } from '@/yanhui/install'

import AppRoot from './App.vue'
import { scheduleInitialLoaderFallback } from './lib/bootstrap/dismiss-initial-loader'
import { setupComponents } from './lib/bootstrap/setup-components'

export async function bootstrap(): Promise<void> {
  initComponentDarkVars()
  setupComponents()
  const i18n = await setupI18n(detectInitialLocale())
  setAppI18n(i18n)
  function storageNotice(key: string) {
    let notice = document.getElementById('storage-notice')
    if (!notice) {
      notice = document.createElement('div')
      notice.id = 'storage-notice'
      notice.setAttribute('role', 'alert')
      notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff4db;color:#563d12;padding:16px;font:15px/1.6 system-ui;'
      document.body.append(notice)
    }
    notice.textContent = t(key)
  }
  window.addEventListener('md:storage-blocked', () => storageNotice('visual.storageBlocked'))
  window.addEventListener('md:storage-reload', () => storageNotice('visual.storageReload'))
  await initStorage()
  document.getElementById('storage-notice')?.remove()
  await installYanhuiTrial()

  const app = createApp(AppRoot)
  app.use(i18n)
  app.use(createPinia())
  useLocaleStore()
  app.mount(`#app`)
  if (import.meta.env.VITE_PRIVATE_SYNC_ENABLED === 'true') {
    const { registerPrivateOffline } = await import('./offline/register')
    void registerPrivateOffline()
  }
  scheduleInitialLoaderFallback()
}
