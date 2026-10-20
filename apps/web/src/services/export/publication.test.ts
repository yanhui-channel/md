// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { wrapCSSWithScope } from '@md/core/theme'
import { defaultPerThemeSettings } from '@md/shared/configs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForPreviewReady } from '@/lib/preview/preview-ready'
import { YANHUI_THEME, yanhuiDefaults } from '@/yanhui/defaults'
import { processClipboardContent } from './clipboard'
import { purePublicationHtml } from './html'
import { getHtmlContent } from './html-content'
import { preparePublication } from './publication'

const state = vi.hoisted(() => ({ markdown: '# Latest\n\nSaved revision', title: 'Frozen title', flush: vi.fn(), theme: {} as any, get: vi.fn() }))
vi.mock('@/stores/editor', () => ({ useEditorStore: () => ({ visualSession: { capture: state.flush }, commitPending: vi.fn() }) }))
vi.mock('@/stores/customComponent', () => ({ useCustomComponentStore: () => ({ registry: {} }) }))
vi.mock('@/lib/visual/capture-theme', () => ({ captureThemeSnapshot: () => structuredClone(state.theme) }))
vi.mock('@/storage/repositories/assets', () => ({ LOCAL_ASSET_PATTERN: /^assets\/[a-f0-9]{64}\.png$/, assetRepo: { get: state.get } }))
vi.mock('@/services/emoji/urlResolver', () => ({ resolveAssetUrl: (url: string) => url }))
vi.mock('@/i18n/translate', () => ({ t: (key: string) => key }))

beforeEach(() => {
  document.body.innerHTML = '<div id="output"><p>Stale preview</p><textarea>Editor chrome</textarea></div>'
  state.markdown = '# Latest\n\nSaved revision'
  state.theme = { id: 'yanhui', settings: defaultPerThemeSettings(), css: '#output p { color: red }', codeCss: '', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false }
  state.get.mockReset()
  state.flush.mockImplementation(() => ({ postId: 'post-a', title: state.title, revision: 3, markdown: state.markdown }))
})
describe('publication snapshot', () => {
  it('copies continuous branded list numbers with their text without changing source or HTML export', async () => {
    state.markdown = '# List example\n\n## Section\n\n6. First **important** item.\n\n7. Next item with a [link](https://example.com).\n\n8. Third item.\n\n9. Fourth item.\n\n10. Last item.'
    state.theme.id = YANHUI_THEME
    state.theme.settings = yanhuiDefaults()
    state.theme.css = wrapCSSWithScope(readFileSync('src/yanhui/theme.css', 'utf8'), '#output')
    const publication = await preparePublication()
    const original = publication.root.innerHTML
    try {
      const copied = await processClipboardContent('#4285f4', publication)
      const root = document.createElement('div')
      root.innerHTML = copied.html
      expect(root.querySelector('ol, ul, li')).toBeNull()
      const markers = [...root.querySelectorAll<HTMLElement>('.yh-list-marker')]
      expect(markers.map(marker => marker.textContent?.trim())).toEqual(['6.', '7.', '8.', '9.', '10.'])
      for (const marker of markers) {
        expect(marker.parentElement?.tagName).toBe('P')
        expect(marker.parentElement?.textContent?.trim().length).toBeGreaterThan(10)
        expect(marker.style.color, marker.outerHTML).not.toBe('')
      }
      expect(root.querySelector('strong')?.textContent).toBe('important')
      expect(root.querySelector('a[href="https://example.com"]')).not.toBeNull()
      expect(publication.root.innerHTML).toBe(original)
      expect(publication.root.querySelector('ol')).not.toBeNull()
      expect(publication.snapshot.markdown).toBe(state.markdown)
    }
    finally { publication.dispose() }
  })
  it('sanitizes the unstyled HTML shared by download and clipboard', async () => {
    state.markdown = '<script>window.stolen = true</script>\n\n<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">保留文字</a>'
    const publication = await preparePublication()
    const html = await purePublicationHtml(publication)
    expect(html).not.toMatch(/<script|onerror|javascript:/i)
    expect(html).toContain('保留文字')
    publication.dispose()
  })
  it('exportsLatestRevisionOnly and exportHasNoEditorChrome', async () => {
    const before = structuredClone(state.theme)
    const pending = preparePublication('light')
    state.theme.css = '#output p { color: blue }'
    const publication = await pending
    expect(publication.snapshot.markdown).toBe(state.markdown)
    expect(publication.root.textContent).toContain('Saved revision')
    expect(publication.root.textContent).not.toContain('Stale preview')
    expect(publication.root.querySelector('[contenteditable], .ProseMirror, textarea, .visual-toolbar')).toBeNull()
    expect(publication.theme).toEqual(before)
    expect(getHtmlContent({ root: publication.root })).toContain('Saved revision')
    publication.dispose()
    expect(document.querySelector('[data-publication-host]')).toBeNull()
  })
  it('localImagesAreEmbeddedInStandaloneHtml without downloading remote images', async () => {
    const path = `assets/${'a'.repeat(64)}.png`
    state.markdown = `![local](${path})\n\n![remote](https://example.org/a.png)`
    state.get.mockResolvedValue({ path, blob: new Blob(['original'], { type: 'image/png' }) })
    const publication = await preparePublication('light')
    expect(publication.root.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(publication.external).toEqual(['https://example.org/a.png'])
    expect(state.get).toHaveBeenCalledTimes(1)
    publication.dispose()
  })
  it('darkExportDoesNotChangeEditor', async () => {
    document.documentElement.classList.add('dark')
    const before = document.getElementById('output')!.outerHTML
    const publication = await preparePublication('light')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.getElementById('output')!.outerHTML).toBe(before)
    publication.dispose()
    document.documentElement.classList.remove('dark')
  })
  it('invalidDiagramCannotLookLikeSuccessfulExport', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="mermaid-diagram" data-md-diagram-state="error">Invalid graph</div>'
    expect(await waitForPreviewReady(0, { root })).toBe(false)
  })
})
