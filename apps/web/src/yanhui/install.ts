import type { InstalledMarketplaceTheme } from '@md/shared'
import type { PerThemeSettingsMap } from '@md/shared/configs'
import { documentRepo, store } from '@/storage'
import { YANHUI_SAMPLE_ID, YANHUI_THEME, yanhuiDefaults } from './defaults'
import headingsCss from './headings.css?raw'
import { assets, sample, sampleTitle } from './resources'
import css from './theme.css?raw'

export async function installYanhuiTrial() {
  try {
    if (!await store.get('MD__yanhui_code_style_v1')) {
      const previous = await store.getJSON<PerThemeSettingsMap>('MD__themeSettings', {})
      if (previous[YANHUI_THEME])
        await store.setJSON('MD__themeSettings', { ...previous, [YANHUI_THEME]: { ...previous[YANHUI_THEME], isMacCodeBlock: true } })
      await store.set('MD__yanhui_code_style_v1', '1')
    }
  }
  catch (error) { console.warn('Optional code style upgrade was not saved', error) }
  try {
    if (!await store.get('MD__yanhui_heading_style_v1')) {
      const installed = await store.getJSON<Record<string, InstalledMarketplaceTheme>>('MD__marketplace_installed_themes', {})
      const theme = installed[YANHUI_THEME]
      if (theme && !theme.css.includes(headingsCss))
        await store.setJSON('MD__marketplace_installed_themes', { ...installed, [YANHUI_THEME]: { ...theme, css: `${theme.css}\n${headingsCss}` } })
      await store.set('MD__yanhui_heading_style_v1', '1')
    }
  }
  catch (error) { console.warn('Optional heading style upgrade was not saved', error) }
  if (await store.get('MD__yanhui_trial_initialized'))
    return

  const installed = await store.getJSON<Record<string, InstalledMarketplaceTheme>>('MD__marketplace_installed_themes', {})
  if (!installed[YANHUI_THEME]) {
    await store.setJSON('MD__marketplace_installed_themes', {
      ...installed,
      [YANHUI_THEME]: {
        marketplaceId: 'yanhui-channel',
        slug: 'yanhui-channel',
        name: '衍辉 channel',
        description: '头像风格 · 清爽留白',
        version: 1,
        coverUrl: assets.avatar,
        primaryColor: '#4285f4',
        css: `${css}\n${headingsCss}`,
        authorLogin: '',
        installedAt: Date.now(),
      },
    })
  }
  const settings = await store.getJSON<PerThemeSettingsMap>('MD__themeSettings', {})
  if (!settings[YANHUI_THEME])
    await store.setJSON('MD__themeSettings', { ...settings, [YANHUI_THEME]: yanhuiDefaults() })

  const posts = await documentRepo.loadAll()
  if (!posts.some(post => post.id === YANHUI_SAMPLE_ID)) {
    const now = new Date()
    await documentRepo.savePost({
      id: YANHUI_SAMPLE_ID,
      title: sampleTitle,
      content: sample,
      createDatetime: now,
      updateDatetime: now,
      history: [{ datetime: now.getTime(), content: sample }],
    })
  }
  if (!(await store.get('MD__current_post_id')))
    await store.set('MD__current_post_id', YANHUI_SAMPLE_ID)
  if (!(await store.get('MD__theme')))
    await store.set('MD__theme', YANHUI_THEME)
  for (const [key, value] of Object.entries({ legend: 'none', locale: 'zh-CN', previewDevice: 'desktop', showAIToolbox: 'false' })) {
    if (await store.get(key) === null)
      await store.set(key, value)
  }
  await store.set('MD__yanhui_trial_initialized', '1')
}
