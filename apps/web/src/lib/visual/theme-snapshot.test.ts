// @vitest-environment jsdom
import { defaultPerThemeSettings } from '@md/shared/configs'
import { describe, expect, it, vi } from 'vitest'
import { validateThemeSnapshot } from './theme-snapshot'

vi.mock('@/stores/theme', () => ({ useThemeStore: vi.fn() }))
vi.mock('@/stores/cssEditor', () => ({ useCssEditorStore: vi.fn() }))
vi.mock('@/stores/marketplace', () => ({ useMarketplaceStore: vi.fn() }))
export function themeFixture() {
  return { id: 'mp:yanhui-channel', settings: defaultPerThemeSettings(), css: '#output p { color: #333; font-size: 17px; }', codeCss: '.hljs { color: #333 }', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false }
}
describe('backup theme validation', () => {
  it('accepts scoped article styles and excludes undeclared settings', () => {
    const theme = validateThemeSnapshot({ ...themeFixture(), secret: 'never export' })
    expect(theme.css).toContain('#output')
    expect(theme).not.toHaveProperty('secret')
    expect(() => validateThemeSnapshot({ ...themeFixture(), previewWidth: 'w-[375px]', css: '/* <safe comment> */ :root { --md-font-size: 17px } section {font-size:17px} #output li:nth-child(4n + 2) {color:red}' })).not.toThrow()
  })
  it.each(['@import "https://evil.example/a.css";', '#output p { background: url(https://evil.example) }', '#output { --remote: image-set("https://example.invalid/track.png" 1x); background-image: var(--remote) }', '#output { background: -webkit-image-set("https://example.invalid/a.png" 1x) }', '#output { --remote: image("https://example.invalid/a.png") }', 'body { display:none }', '#output + header { display:none }', '#output p { position: fixed }'])('rejects hostile CSS: %s', (css) => {
    expect(() => validateThemeSnapshot({ ...themeFixture(), css })).toThrow()
  })
  it('rejects unbounded typography and stylesheet URLs from imported settings', () => {
    expect(() => validateThemeSnapshot({ ...themeFixture(), settings: { ...defaultPerThemeSettings(), fontSize: '9999px' } })).toThrow()
    const theme = validateThemeSnapshot(themeFixture())
    expect(theme.settings.codeBlockTheme).not.toMatch(/^https?:/)
  })
})
