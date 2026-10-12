import type { PerThemeSettings } from '@md/shared/configs'
import type { ThemeSnapshot } from './theme-snapshot'
import { buildThemeCSS } from '@md/core/theme'
import { defaultPerThemeSettings } from '@md/shared/configs'
import { getActivePinia } from 'pinia'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { getDatabase } from '@/storage/db'
import { getLocalDraft } from '@/storage/repositories/private-sync'
import { useCssEditorStore } from '@/stores/cssEditor'
import { useMarketplaceStore } from '@/stores/marketplace'
import { usePostStore } from '@/stores/post'
import { useThemeStore } from '@/stores/theme'
import localCodeCss from '../../../public/yanhui-code.css?raw'
import { validateThemeSnapshot } from './theme-snapshot'

export async function captureThemeSnapshot(): Promise<ThemeSnapshot> {
  const store = useThemeStore()
  if (store.restoredTheme) {
    const snapshot = JSON.parse(JSON.stringify(store.restoredTheme))
    snapshot.codeCss = await store.resolveCodeCss(store.restoredTheme)
    return snapshot
  }
  const settings: PerThemeSettings = JSON.parse(JSON.stringify({ ...defaultPerThemeSettings(), ...store.themeSettings[store.theme] }))
  const customCSS = useCssEditorStore().getCurrentTabContent()
  const snapshot: ThemeSnapshot = {
    id: store.theme,
    settings,
    css: buildThemeCSS({ themeName: store.theme, themeCSS: useMarketplaceStore().getInstalledThemeCss(store.theme), customCSS: PRIVATE_SYNC_ENABLED ? undefined : customCSS, variables: { ...settings, isUseIndent: store.isUseIndent, isUseJustify: store.isUseJustify } }, false),
    customCss: PRIVATE_SYNC_ENABLED ? customCSS : undefined,
    codeCss: localCodeCss,
    previewWidth: store.previewWidth,
    legend: store.legend,
    citeStatus: store.isCiteStatus,
    countStatus: store.isCountStatus,
    indent: store.isUseIndent,
    justify: store.isUseJustify,
  }
  if (!settings.codeBlockTheme.endsWith('/yanhui-code.css')) {
    const response = await fetch(settings.codeBlockTheme, { signal: AbortSignal.timeout(5000) })
    if (!response.ok)
      throw new Error('visual.exportThemeFailed')
    snapshot.codeCss = await response.text()
  }
  return snapshot
}

export async function captureStoredArticleTheme(postId: string): Promise<ThemeSnapshot> {
  const posts = getActivePinia() ? usePostStore() : null
  const pending = posts?.getPendingTheme?.(postId)
  if (pending)
    return validateThemeSnapshot(await pending)
  if (posts?.currentPost?.id === postId) {
    const signature = () => JSON.stringify({ post: posts.currentPost, theme: useThemeStore().restoredTheme ?? useThemeStore().$state, css: useCssEditorStore().cssContentConfig })
    const before = signature()
    const result = await captureThemeSnapshot()
    if (posts.currentPost?.id !== postId || signature() !== before)
      throw new Error('theme_capture_changed')
    return validateThemeSnapshot(result)
  }
  const draft = await getLocalDraft(postId)
  if (draft?.theme)
    return validateThemeSnapshot(draft.theme)
  const db = await getDatabase()
  const post = await db.get('documents', postId)
  const row = post?.themeId ? await db.get('settings', post.themeId) : null
  if (!row)
    throw new Error('theme_capture_required')
  return validateThemeSnapshot(JSON.parse(row.value))
}
