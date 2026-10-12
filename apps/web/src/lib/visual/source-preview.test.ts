import { renderMermaidSvg } from '@md/core/extensions'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisualCodec } from './codec'
import { createSourcePreview, renderSourcePreview, sanitizeRenderedHtml } from './source-preview'
import * as previews from './source-preview'

vi.mock('@md/core/extensions', () => ({ renderMermaidSvg: vi.fn() }))

afterEach(() => vi.useRealTimers())
describe('technical source previews', () => {
  it('renders stored code inside styled quotes for preview and export without losing surrounding styles', () => {
    const codec = createVisualCodec()
    const block = codec.parse('```java\npublic class Demo {}\n```').content![0]
    const encoded = codec.serialize({ type: 'doc', content: [{ type: 'blockquote', attrs: { lineHeight: '2' }, content: [block] }] })
    expect(previews.renderStoredCodeBlocks).toBeTypeOf('function')
    const root = document.createElement('div')
    root.innerHTML = previews.renderStoredCodeBlocks(encoded, false)
    expect(root.querySelector('blockquote')?.style.lineHeight).toBe('2')
    expect(root.querySelector('.hljs-keyword')?.textContent).toBe('public')
    expect(root.querySelector('.code__pre code')?.textContent).toContain('class')
    expect(root.querySelectorAll('.mac-sign ellipse')).toHaveLength(3)
    expect(root.querySelector('[data-source-block]')).toBeNull()
  })
  it('renders stored code as text even if the source contains HTML; ignores malformed metadata', () => {
    const codec = createVisualCodec()
    const source = '<img src=x onerror=evil()>\n  keep'
    const block = codec.parse(`\`\`\`unknown\n${source}\n\`\`\``).content![0]
    const encoded = codec.serialize({ type: 'doc', content: [{ type: 'blockquote', attrs: { lineHeight: '2' }, content: [block] }] })
    expect(previews.renderStoredCodeBlocks).toBeTypeOf('function')
    const root = document.createElement('div')
    root.innerHTML = previews.renderStoredCodeBlocks(encoded, false)
    expect(root.querySelector('img,[onerror]')).toBeNull()
    expect(root.querySelector('code')?.textContent).toContain('<img')
    root.innerHTML = previews.renderStoredCodeBlocks('<pre data-source-block="bad"><code>keep</code></pre>', false)
    expect(root.querySelector('code')?.textContent).toBe('keep')
  })
  it.each([
    ['java', 'public class Demo { int count = 3; }'],
    ['sql', 'SELECT name FROM users WHERE id = 3;'],
    ['yaml', 'enabled: true\nname: demo'],
    ['json', '{ "enabled": true, "count": 3 }'],
    ['js', 'const count = 3;'],
    ['ts', 'const count: number = 3;'],
    ['python', 'def count():\n  return 3'],
    ['bash', 'echo "$HOME"'],
    ['html', '<div class="demo">Hello</div>'],
    ['css', '.demo { color: red; }'],
  ])('highlights %s locally while preserving the exact source', async (language, source) => {
    const root = document.createElement('div')
    root.innerHTML = await renderSourcePreview({ kind: 'code', source, language, themeMode: 'light' })
    expect(root.querySelector('[class^="hljs-"]')).not.toBeNull()
    expect(root.querySelector('code')?.textContent).toBe(source)
  })
  it('keeps unknown languages inert and readable', async () => {
    const source = '<img src=x onerror="evil()">\n  keep  '
    const root = document.createElement('div')
    root.innerHTML = await renderSourcePreview({ kind: 'code', source, language: 'unknown-language', themeMode: 'light' })
    expect(root.querySelector('code')?.textContent).toBe(source)
    expect(root.querySelector('img,[onerror]')).toBeNull()
  })
  it('preserves diagram label layout and classes without allowing active content', () => {
    const root = document.createElement('div')
    root.innerHTML = sanitizeRenderedHtml('<svg><foreignObject><div style="display:table-cell;white-space:nowrap" class="nodeLabel"><p>Start</p><img src="https://example.org" onerror="evil()"></div></foreignObject></svg>')
    expect(root.querySelector<HTMLElement>('.nodeLabel')?.style.display).toBe('table-cell')
    expect(root.querySelector('img')).toBeNull()
  })
  it('keeps Mermaid HTML labels while removing executable content', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml"><span onclick="evil()">中文节点</span><script>evil()</script></div></foreignObject></svg>')
    const result = await renderSourcePreview({ kind: 'mermaid', source: 'graph', themeMode: 'light' })
    const container = document.createElement('div')
    container.innerHTML = result
    expect(container.querySelector('foreignObject')?.textContent).toBe('中文节点')
    expect(container.querySelector('[onclick],script')).toBeNull()
  })
  it('keepsCodeWhitespace without executing embedded markup', async () => {
    const source = '\tlet a = 1;\n\n  <script>alert(1)</script>  '
    const container = document.createElement('div')
    container.innerHTML = await renderSourcePreview({ kind: 'code', source, language: 'js', themeMode: 'light' })
    expect(container.querySelector('code')?.textContent).toBe(source)
    expect(container.querySelector('script')).toBeNull()
  })
  it('invalidMathPreservesSource and rejects MathJax error output', async () => {
    window.MathJax = { tex2svg: () => {
      const div = document.createElement('div')
      div.innerHTML = '<svg><g data-mjx-error="Unknown command"/></svg>'
      return div
    } } as unknown as typeof window.MathJax
    const codec = createVisualCodec()
    const source = '$$\n\\badcommand{x}\n$$'
    const doc = codec.parse(source)
    await expect(renderSourcePreview({ kind: 'math', source: '\\badcommand{x}', themeMode: 'light' })).rejects.toThrow('Unknown command')
    expect(codec.serialize(doc)).toBe(source)
  })
  it('latestMermaidResultWins even before the next debounce fires', async () => {
    vi.useFakeTimers()
    let finishA!: (html: string) => void
    let finishB!: (html: string) => void
    const render = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve })).mockImplementationOnce(() => new Promise((resolve) => { finishB = resolve }))
    const onChange = vi.fn()
    const preview = createSourcePreview(onChange, render)
    preview.update({ kind: 'mermaid', source: 'A', themeMode: 'light' })
    await vi.advanceTimersByTimeAsync(300)
    preview.update({ kind: 'mermaid', source: 'B', themeMode: 'light' })
    finishA('<svg>A</svg>')
    await vi.advanceTimersByTimeAsync(300)
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ html: '<svg>A</svg>' }))
    finishB('<svg>B</svg>')
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenLastCalledWith({ html: '<svg>B</svg>', error: '', status: 'ready' })
    preview.dispose()
  })
  it('retains last good preview on error and ignores work after disposal', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const preview = createSourcePreview(onChange, vi.fn().mockResolvedValueOnce('good').mockRejectedValueOnce(new Error('bad source')))
    const input = { kind: 'mermaid' as const, source: 'good', themeMode: 'light' as const }
    preview.update(input)
    await vi.advanceTimersByTimeAsync(300)
    preview.update({ ...input, source: 'bad' })
    await vi.advanceTimersByTimeAsync(300)
    expect(onChange).toHaveBeenLastCalledWith({ html: 'good', error: 'bad source', status: 'error' })
    preview.update(input)
    preview.dispose()
    onChange.mockClear()
    await vi.advanceTimersByTimeAsync(300)
    expect(onChange).not.toHaveBeenCalled()
  })
  it('rawBlockEditsInPlace without flattening or unsafe preview HTML', async () => {
    const codec = createVisualCodec()
    const doc = codec.parse('<div>original</div>')
    doc.content![0].attrs!.source = '<div>changed</div><script>alert(1)</script>'
    expect(codec.serialize(doc)).toBe('<div>changed</div><script>alert(1)</script>')
    const html = await renderSourcePreview({ kind: 'raw', source: doc.content![0].attrs!.source, themeMode: 'light' })
    expect(html).toContain('changed')
    expect(html).not.toContain('<script')
  })
})
