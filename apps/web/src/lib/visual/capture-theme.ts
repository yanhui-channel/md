import type { PerThemeSettings } from '@md/shared/configs'
import type { ThemeSnapshot } from './theme-snapshot'
import { buildThemeCSS } from '@md/core/theme'
import { defaultPerThemeSettings } from '@md/shared/configs'
import { useCssEditorStore } from '@/stores/cssEditor'
import { useMarketplaceStore } from '@/stores/marketplace'
import { useThemeStore } from '@/stores/theme'
import localCodeCss from '../../../public/yanhui-code.css?raw'

export async function captureThemeSnapshot(): Promise<ThemeSnapshot> {
  const store = useThemeStore()
  if (store.restoredTheme)
    return JSON.parse(JSON.stringify(store.restoredTheme))
  const settings: PerThemeSettings = JSON.parse(JSON.stringify({ ...defaultPerThemeSettings(), ...store.themeSettings[store.theme] }))
  const snapshot: ThemeSnapshot = {
    id: store.theme,
    settings,
    css: buildThemeCSS({ themeName: store.theme, themeCSS: useMarketplaceStore().getInstalledThemeCss(store.theme), customCSS: useCssEditorStore().getCurrentTabContent(), variables: { ...settings, isUseIndent: store.isUseIndent, isUseJustify: store.isUseJustify } }, false),
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
