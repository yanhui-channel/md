// @vitest-environment jsdom
import { defaultPerThemeSettings } from '@md/shared/configs'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { captureStoredArticleTheme } from '@/lib/visual/capture-theme'
import { useCssEditorStore } from './cssEditor'
import { usePostStore } from './post'
import { useThemeStore } from './theme'

const state = vi.hoisted(() => ({ settings: new Map<string, any>(), saved: new Map<string, any>() }))
await vi.hoisted(async () => { Object.assign(globalThis, { defineStore: (await import('pinia')).defineStore }) })
vi.mock('@/services/account/config', () => ({ PRIVATE_SYNC_ENABLED: true }))
vi.mock('@/assets/example/default-content', () => ({ getDefaultContent: () => '' }))
vi.mock('@/i18n/translate', () => ({ t: (v: string) => v, getLocale: () => 'zh-CN' }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => ({ flushContentToPostStore() {} }) }))
vi.mock('@/stores/marketplace', () => ({ useMarketplaceStore: () => ({ getInstalledThemeCss: () => '' }) }))
vi.mock('@/storage/repositories/documents-backup', () => ({ writeDocumentsPagehideBackup() {}, clearDocumentsPagehideBackup() {} }))
vi.mock('@/storage/repositories/private-sync', () => ({ getLocalDraft: async (id: string) => ({ theme: state.saved.get(id) }) }))
vi.mock('@/storage', async () => {
  const { ref } = await import('vue')
  const persist = async (posts: any[]) => {
    for (const post of posts)
      state.saved.set(post.id, await captureStoredArticleTheme(post.id))
  }
  return {
    getLoadedDocuments: () => ['a', 'b'].map(id => ({ id, title: id, content: id, history: [], createDatetime: new Date(0), updateDatetime: new Date(0), themeId: `theme:${id}` })),
    documentRepo: { saveAll: persist, savePost: (post: any) => persist([post]) },
    store: { getSync: (key: string) => JSON.stringify(state.settings.get(key)), get: async (key: string) => JSON.stringify(state.settings.get(key)), reactive: (key: string, fallback: any) => ref(key.endsWith('current_post_id') ? 'a' : fallback) },
  }
})

let app: Vue.App
beforeEach(() => {
  state.settings.clear(); state.saved.clear()
  for (const [key, value] of Object.entries(Vue)) vi.stubGlobal(key, value)
  vi.stubGlobal('defineStore', defineStore)
  vi.stubGlobal('useToggle', (value: Vue.Ref<boolean>) => () => { value.value = !value.value })
  vi.stubGlobal('useDark', () => Vue.ref(false))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('.hljs { color: blue }')))
  for (const id of ['a', 'b']) {
    const theme = { id: 'default', settings: { ...defaultPerThemeSettings(), fontSize: '17px', codeBlockTheme: '/yanhui-code.css' }, css: '#output p { color:red }', codeCss: '.hljs { color:red }', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false }
    state.settings.set(`theme:${id}`, theme); state.saved.set(id, structuredClone(theme))
  }
  const pinia = createPinia(); setActivePinia(pinia)
  app = Vue.createApp({ setup() { usePostStore(); useThemeStore(); useCssEditorStore(); return () => null } })
  app.use(pinia); app.mount(document.createElement('div'))
})
afterEach(() => { app?.unmount(); vi.unstubAllGlobals() })

it('themeChangedBeforeDebounceSurvivesImmediateArticleSwitch', async () => {
  const posts = usePostStore(); const theme = useThemeStore()
  theme.fontSize = '18px'
  posts.currentPostId = 'b'
  await posts.persistImmediately()
  expect(state.saved.get('a').settings.fontSize).toBe('18px')
  expect(state.saved.get('b').settings.fontSize).toBe('17px')
})
it('restoredArticleCustomCssEditsReachItsOwnSnapshotAndExport', async () => {
  const css = useCssEditorStore(); const theme = useThemeStore()
  document.body.innerHTML = '<div><textarea id="cssEditor"></textarea></div>'
  css.initCssEditor(() => { void theme.applyCurrentTheme() })
  css.setCssEditorValue('#output p { color: blue }')
  await theme.applyCurrentTheme()
  const captured = await captureStoredArticleTheme('a')
  const { renderSnapshotCss } = await import('@/lib/visual/theme-snapshot')
  expect(renderSnapshotCss(captured)).toContain('blue')
  expect(state.settings.get('theme:b').css).not.toContain('blue')
  css.cssEditor?.destroy()
})
it('restoredArticleCodePaletteUpdatesCssAndSurvivesSwitchDuringFetch', async () => {
  const posts = usePostStore(); const theme = useThemeStore()
  const original = theme.restoredTheme!
  theme.codeBlockTheme = '/highlight-styles/github.css'
  const loading = theme.updateCodeTheme()
  posts.currentPostId = 'b'
  await loading
  await posts.persistImmediately()
  expect(state.saved.get('a').codeCss).toContain('blue')
  expect(original.codeCss).toContain('blue')
  expect(theme.restoredTheme!.codeCss).not.toContain('blue')
})
it('failedCodePaletteLoadCanRetryWithoutChangingTheSelection', async () => {
  const theme = useThemeStore()
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  theme.codeBlockTheme = '/highlight-styles/github.css'
  await expect(theme.resolveCodeCss(theme.restoredTheme!)).rejects.toThrow('offline')
  await expect(theme.resolveCodeCss(theme.restoredTheme!)).resolves.toContain('blue')
})
