import { beforeEach, expect, it, vi } from 'vitest'
import { store } from '@/storage'
import { YANHUI_THEME, yanhuiDefaults } from './defaults'
import { installYanhuiTrial } from './install'

const { saved, documentRepo } = vi.hoisted(() => ({ saved: new Map<string, any>(), documentRepo: { loadAll: vi.fn(), savePost: vi.fn() } }))
vi.mock('@/storage', () => ({
  documentRepo,
  store: {
    get: async (key: string) => saved.get(key) ?? null,
    set: async (key: string, value: unknown) => { saved.set(key, value) },
    getJSON: async (key: string, fallback: unknown) => saved.get(key) ?? fallback,
    setJSON: async (key: string, value: unknown) => { saved.set(key, value) },
  },
}))
vi.mock('./resources', () => ({ assets: { avatar: '' }, sample: '# Sample', sampleTitle: 'Sample' }))
vi.mock('./headings.css?raw', async () => {
  const { readFileSync } = await import('node:fs')
  return { default: readFileSync(new URL('./headings.css', import.meta.url), 'utf8') }
})

beforeEach(() => { saved.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })
it('uses the supplied sample title instead of a private article title on first run', async () => {
  documentRepo.loadAll.mockResolvedValue([])
  await installYanhuiTrial()
  expect(documentRepo.savePost).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sample', content: '# Sample' }))
})
it('still opens existing articles if the optional style upgrade cannot be saved', async () => {
  saved.set('MD__yanhui_trial_initialized', '1')
  saved.set('MD__themeSettings', { [YANHUI_THEME]: yanhuiDefaults() })
  vi.spyOn(store, 'setJSON').mockRejectedValueOnce(new Error('Storage full'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(installYanhuiTrial()).resolves.toBeUndefined()
  expect(saved.has('MD__yanhui_code_style_v1')).toBe(false)
})
it('enables the new code style once without touching articles or other preferences', async () => {
  saved.set('MD__yanhui_trial_initialized', '1')
  const original = { ...yanhuiDefaults(), isMacCodeBlock: false, fontSize: '19px', lineHeight: '2.2' }
  saved.set('MD__themeSettings', { [YANHUI_THEME]: original, custom: { fontSize: '21px' } })
  await installYanhuiTrial()
  expect(saved.get('MD__themeSettings')).toEqual({ [YANHUI_THEME]: { ...original, isMacCodeBlock: true }, custom: { fontSize: '21px' } })
  expect(documentRepo.loadAll).not.toHaveBeenCalled()
  expect(documentRepo.savePost).not.toHaveBeenCalled()
  saved.get('MD__themeSettings')[YANHUI_THEME].isMacCodeBlock = false
  await installYanhuiTrial()
  expect(saved.get('MD__themeSettings')[YANHUI_THEME].isMacCodeBlock).toBe(false)
})
it('does not create settings for a removed personal theme', async () => {
  saved.set('MD__yanhui_trial_initialized', '1')
  await installYanhuiTrial()
  expect(saved.has('MD__themeSettings')).toBe(false)
  expect(saved.has('MD__marketplace_installed_themes')).toBe(false)
})

it('adds heading styles once and preserves custom CSS, preferences and documents', async () => {
  saved.set('MD__yanhui_trial_initialized', '1')
  const original = { css: '.my-custom { color: red; }', version: 3 }
  saved.set('MD__marketplace_installed_themes', { [YANHUI_THEME]: original, other: { css: 'other' } })
  await installYanhuiTrial()
  const installed = saved.get('MD__marketplace_installed_themes')
  expect(installed[YANHUI_THEME].css).toContain(original.css)
  expect(installed[YANHUI_THEME].css).toContain('.yh-heading[data-yh-depth]')
  expect(installed[YANHUI_THEME].version).toBe(3)
  expect(installed.other).toEqual({ css: 'other' })
  await installYanhuiTrial()
  expect(saved.get('MD__marketplace_installed_themes')).toBe(installed)
  expect(documentRepo.savePost).not.toHaveBeenCalled()
})
