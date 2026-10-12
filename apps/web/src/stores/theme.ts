import type { HeadingLevel, HeadingStyles, HeadingStyleType, PerThemeSettings, PerThemeSettingsMap, ThemeName } from '@md/shared/configs'
import type { Ref } from 'vue'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import { applyTheme, getThemeInjector } from '@md/core/theme'
import { defaultPerThemeSettings, defaultStyleConfig, widthOptions } from '@md/shared/configs'
import { isMarketplaceThemeKey } from '@md/shared/types'
import { renderSnapshotCss, validateThemeSnapshot } from '@/lib/visual/theme-snapshot'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { store } from '@/storage'
import { addPrefix } from '@/storage/prefix'
import { useCssEditorStore } from '@/stores/cssEditor'
import { usePostStore } from '@/stores/post'
import { YANHUI_THEME, yanhuiDefaults } from '@/yanhui/defaults'

/**
 * Theme and style configuration.
 *
 * Each theme has its own settings (primaryColor, fontFamily, fontSize, lineHeight,
 * blockSpacing, linkColor, blockquoteBackground, codeBlockTheme, headingStyles,
 * isShowLineNumber, isMacCodeBlock); switching themes loads the matching config.
 */
export const useThemeStore = defineStore(`theme`, () => {
  const baseTheme = store.reactive<ThemeName>(addPrefix(`theme`), defaultStyleConfig.theme)
  const postStore = usePostStore()
  const snapshots = new Map<string, Ref<ThemeSnapshot>>()
  const restoredTheme = computed(() => {
    const key = postStore.currentPost?.themeId
    if (!key)
      return null
    if (!snapshots.has(key)) {
      const raw = store.getSync(key)
      if (!raw)
        return null
      const snapshot = validateThemeSnapshot(JSON.parse(raw))
      snapshots.set(key, PRIVATE_SYNC_ENABLED ? ref(snapshot) : store.reactive(key, snapshot))
    }
    return snapshots.get(key)!.value
  })
  const theme = computed<ThemeName>({
    get: () => restoredTheme.value?.id as ThemeName ?? baseTheme.value,
    set: (value) => {
      if (postStore.currentPost)
        postStore.currentPost.themeId = undefined
      baseTheme.value = value
    },
  })

  const themeSettings = store.reactive<PerThemeSettingsMap>(
    addPrefix(`themeSettings`),
    {},
  )

  const currentSettings = computed<PerThemeSettings>(() => {
    return restoredTheme.value?.settings ?? themeSettings.value[theme.value] ?? defaultPerThemeSettings()
  })

  const primaryColor = computed<string>({
    get: () => currentSettings.value.primaryColor,
    set: (v: string) => { setThemeField(`primaryColor`, v) },
  })

  const fontFamily = computed<string>({
    get: () => currentSettings.value.fontFamily,
    set: (v: string) => { setThemeField(`fontFamily`, v) },
  })

  const fontSize = computed<string>({
    get: () => currentSettings.value.fontSize,
    set: (v: string) => { setThemeField(`fontSize`, v) },
  })

  // Settings persisted before these options existed have no value stored, so the
  // getters fall back to the default instead of leaving the picker unselected.
  const lineHeight = computed<string>({
    get: () => currentSettings.value.lineHeight ?? defaultStyleConfig.lineHeight,
    set: (v: string) => { setThemeField(`lineHeight`, v) },
  })

  const blockSpacing = computed<string>({
    get: () => currentSettings.value.blockSpacing ?? defaultStyleConfig.blockSpacing,
    set: (v: string) => { setThemeField(`blockSpacing`, v) },
  })

  const linkColor = computed<string>({
    get: () => currentSettings.value.linkColor ?? defaultStyleConfig.linkColor,
    set: (v: string) => { setThemeField(`linkColor`, v) },
  })

  const blockquoteBackground = computed<string>({
    get: () => currentSettings.value.blockquoteBackground ?? defaultStyleConfig.blockquoteBackground,
    set: (v: string) => { setThemeField(`blockquoteBackground`, v) },
  })

  const codeBlockTheme = computed<string>({
    get: () => currentSettings.value.codeBlockTheme,
    set: (v: string) => { setThemeField(`codeBlockTheme`, v) },
  })

  const headingStyles = computed<HeadingStyles>({
    get: () => currentSettings.value.headingStyles,
    set: (v: HeadingStyles) => { setThemeField(`headingStyles`, v) },
  })

  const isShowLineNumber = computed<boolean>({
    get: () => currentSettings.value.isShowLineNumber,
    set: (v: boolean) => { setThemeField(`isShowLineNumber`, v) },
  })

  const isMacCodeBlock = computed<boolean>({
    get: () => currentSettings.value.isMacCodeBlock,
    set: (v: boolean) => { setThemeField(`isMacCodeBlock`, v) },
  })

  function setThemeField<K extends keyof PerThemeSettings>(key: K, value: PerThemeSettings[K]) {
    if (restoredTheme.value) { restoredTheme.value.settings[key] = value; return }
    const t = theme.value
    const existing = themeSettings.value[t] ?? defaultPerThemeSettings()
    themeSettings.value = {
      ...themeSettings.value,
      [t]: { ...existing, [key]: value },
    }
  }

  function articleOption<K extends 'citeStatus' | 'countStatus' | 'indent' | 'justify' | 'legend' | 'previewWidth'>(key: K, storageKey: string, fallback: ThemeSnapshot[K]) {
    const original = store.reactive(storageKey, fallback)
    return computed<ThemeSnapshot[K]>({
      get: () => restoredTheme.value?.[key] ?? original.value,
      set: (value) => {
        if (restoredTheme.value)
          restoredTheme.value[key] = value; else original.value = value
      },
    })
  }
  const isCiteStatus = articleOption('citeStatus', 'isCiteStatus', defaultStyleConfig.isCiteStatus)
  const isCountStatus = articleOption('countStatus', 'isCountStatus', defaultStyleConfig.isCountStatus)
  const isUseIndent = articleOption('indent', addPrefix('use_indent'), false)
  const isUseJustify = articleOption('justify', addPrefix('use_justify'), false)
  const legend = articleOption('legend', 'legend', defaultStyleConfig.legend)
  const previewWidth = articleOption('previewWidth', 'previewWidth', widthOptions[0].value)

  const fontSizeNumber = computed(() => Number(fontSize.value.replace(`px`, ``)))

  const toggleMacCodeBlock = useToggle(isMacCodeBlock)
  const toggleShowLineNumber = useToggle(isShowLineNumber)
  const toggleCiteStatus = useToggle(isCiteStatus)
  const toggleCountStatus = useToggle(isCountStatus)
  const toggleUseIndent = useToggle(isUseIndent)
  const toggleUseJustify = useToggle(isUseJustify)

  const resetStyle = () => {
    if (restoredTheme.value) {
      restoredTheme.value.settings = theme.value === YANHUI_THEME ? yanhuiDefaults() : defaultPerThemeSettings()
    }
    else {
      themeSettings.value = {
        ...themeSettings.value,
        [theme.value]: theme.value === YANHUI_THEME ? yanhuiDefaults() : defaultPerThemeSettings(),
      }
    }
    isCiteStatus.value = defaultStyleConfig.isCiteStatus
    isCountStatus.value = defaultStyleConfig.isCountStatus
    legend.value = theme.value === YANHUI_THEME ? 'none' : defaultStyleConfig.legend
    isUseIndent.value = false
    isUseJustify.value = false
  }

  const setHeadingStyle = (level: HeadingLevel, style: HeadingStyleType) => {
    const existing = headingStyles.value
    headingStyles.value = {
      ...existing,
      [level]: style === `default` ? undefined : style,
    }
  }

  const getHeadingStyle = (level: HeadingLevel): HeadingStyleType => {
    return headingStyles.value[level] || `default`
  }

  const updateCodeTheme = () => {
    document.querySelector('#article-code-theme')?.remove()
    if (restoredTheme.value) {
      document.querySelector('#hljs')?.remove()
      const style = document.createElement('style')
      style.id = 'article-code-theme'
      const css = restoredTheme.value.codeCss
      style.textContent = `${css}\n${css.replace(/#output/g, '.visual-source-preview')}`
      document.head.append(style)
      return
    }
    const cssUrl = codeBlockTheme.value
    const el = document.querySelector(`#hljs`)

    if (el) {
      if (el.getAttribute(`href`) === cssUrl)
        return
      el.setAttribute(`href`, cssUrl)
    }
    else {
      const link = document.createElement(`link`)
      link.setAttribute(`type`, `text/css`)
      link.setAttribute(`rel`, `stylesheet`)
      link.setAttribute(`href`, cssUrl)
      link.setAttribute(`id`, `hljs`)
      document.head.appendChild(link)
    }
  }

  const applyCurrentTheme = async () => {
    try {
      if (restoredTheme.value) { getThemeInjector().inject(renderSnapshotCss(restoredTheme.value)); return }
      const cssEditorStore = useCssEditorStore()
      const customCSS = cssEditorStore.getCurrentTabContent()

      // Lazy import avoids Pinia circular init with marketplace store
      let themeCSS: string | undefined
      if (isMarketplaceThemeKey(theme.value)) {
        const { useMarketplaceStore } = await import(`@/stores/marketplace`)
        themeCSS = useMarketplaceStore().getInstalledThemeCss(theme.value)
      }

      await applyTheme({
        themeName: theme.value,
        themeCSS,
        customCSS,
        variables: {
          primaryColor: primaryColor.value,
          fontFamily: fontFamily.value,
          fontSize: fontSize.value,
          lineHeight: lineHeight.value,
          blockSpacing: blockSpacing.value,
          linkColor: linkColor.value,
          blockquoteBackground: blockquoteBackground.value,
          isUseIndent: isUseIndent.value,
          isUseJustify: isUseJustify.value,
          headingStyles: headingStyles.value,
        },
      })
    }
    catch (error) {
      console.error(`[applyCurrentTheme] 主题应用失败:`, error)
    }
  }

  watch(() => postStore.currentPost?.themeId, () => {
    void applyCurrentTheme()
    updateCodeTheme()
  })

  return {
    restoredTheme,
    theme,
    themeSettings,
    fontFamily,
    fontSize,
    fontSizeNumber,
    lineHeight,
    blockSpacing,
    linkColor,
    blockquoteBackground,
    primaryColor,
    codeBlockTheme,
    legend,
    isMacCodeBlock,
    isShowLineNumber,
    isCiteStatus,
    isCountStatus,
    isUseIndent,
    isUseJustify,
    previewWidth,
    headingStyles,
    toggleMacCodeBlock,
    toggleShowLineNumber,
    toggleCiteStatus,
    toggleCountStatus,
    toggleUseIndent,
    toggleUseJustify,
    resetStyle,
    updateCodeTheme,
    applyCurrentTheme,
    setHeadingStyle,
    getHeadingStyle,
  }
})
