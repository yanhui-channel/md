// @vitest-environment jsdom
import { defaultPerThemeSettings } from '@md/shared/configs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { captureStoredArticleTheme } from './capture-theme'

const state = vi.hoisted(() => ({ post: { currentPost: { id: 'a', content: 'first' } }, theme: {} as any }))
vi.mock('@/stores/post', () => ({ usePostStore: () => state.post }))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => state.theme }))
vi.mock('@/stores/cssEditor', () => ({ useCssEditorStore: () => ({ cssContentConfig: {}, getCurrentTabContent: () => '' }) }))
vi.mock('@/stores/marketplace', () => ({ useMarketplaceStore: () => ({ getInstalledThemeCss: () => '' }) }))
vi.mock('@/storage/db', () => ({ getDatabase: vi.fn() }))
vi.mock('@/storage/repositories/private-sync', () => ({ getLocalDraft: async () => null }))
afterEach(() => { vi.unstubAllGlobals(); setActivePinia(undefined) })
it('rejectsThemeCaptureIfTheArticleChangesDuringAnAwait', async () => {
  setActivePinia(createPinia())
  state.post.currentPost = { id: 'a', content: 'first' }
  state.theme = { $state: {}, theme: 'default', themeSettings: { default: { ...defaultPerThemeSettings(), codeBlockTheme: 'https://example.invalid/code.css' } }, previewWidth: '750px', legend: 'none', isCiteStatus: false, isCountStatus: false, isUseIndent: false, isUseJustify: false }
  let respond!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
  const capture = captureStoredArticleTheme('a')
  state.post.currentPost = { id: 'b', content: 'second' }
  respond(new Response('.hljs {color:#333}'))
  await expect(capture).rejects.toThrow('theme_capture_changed')
})
