import { renderMermaidSvg } from '@md/core/extensions'
import { hljs, macCodeSvg } from '@md/core/renderer'
import { ensureMathJaxLoaded, highlightAndFormatCode, uniqueSvgIds } from '@md/core/utils'
import { MarkdownManager } from '@tiptap/markdown'
import DOMPurify from 'isomorphic-dompurify'
import { sanitizeVisualHtml } from './style'

export interface SourcePreviewInput { kind: 'code' | 'math' | 'mermaid' | 'raw', source: string, language?: string, themeMode: 'light' | 'dark' }
export interface SourcePreviewState { html: string, error: string, status: 'loading' | 'ready' | 'error' }

// Styled containers are stored as HTML, so their code fences bypass marked.
export function renderStoredCodeBlocks(html: string, showLineNumber: boolean): string {
  if (!html.includes('data-source-block'))
    return html
  const root = document.createElement('div')
  root.innerHTML = html
  for (const pre of root.querySelectorAll('pre[data-source-block]')) {
    try {
      const attrs = JSON.parse(pre.getAttribute('data-source-block')!)
      if (attrs.kind !== 'code' || typeof attrs.source !== 'string' || typeof attrs.language !== 'string')
        continue
      const requested = attrs.language.trim().split(/\s+/)[0].toLowerCase()
      const language = hljs.getLanguage(requested) ? requested : 'plaintext'
      const code = document.createElement('code')
      code.className = `language-${language}`
      code.innerHTML = highlightAndFormatCode(attrs.source, language, hljs, showLineNumber)
      const dots = document.createElement('span')
      dots.className = 'mac-sign'
      dots.style.padding = '10px 14px 0'
      dots.innerHTML = macCodeSvg
      pre.className = 'hljs code__pre'
      pre.removeAttribute('data-source-block')
      pre.replaceChildren(dots, code)
    }
    catch { /* Keep the inert fallback when imported metadata is invalid. */ }
  }
  return root.innerHTML
}

const parser = new MarkdownManager({ extensions: [], markedOptions: { gfm: true } }).instance
export async function renderSourcePreview(input: SourcePreviewInput): Promise<string> {
  const { kind, source, themeMode, language } = input
  if (kind === 'raw')
    return sanitizeVisualHtml(await parser.parse(source))
  let html: string
  if (kind === 'mermaid') {
    html = await renderMermaidSvg(source, themeMode)
  }
  else if (kind === 'math') {
    await ensureMathJaxLoaded()
    const svg = window.MathJax!.tex2svg(source, { display: true }).firstChild
    const error = svg?.querySelector('[data-mjx-error], [data-mml-node="merror"]')
    if (error)
      throw new Error(error.getAttribute('data-mjx-error') || error.textContent || 'Invalid formula')
    if (!svg || svg.localName !== 'svg')
      throw new Error('Invalid formula')
    html = uniqueSvgIds(svg.outerHTML)
  }
  else {
    const code = document.createElement('code')
    const grammar = language?.trim().split(/\s+/)[0].toLowerCase()
    if (grammar && hljs.getLanguage(grammar))
      code.innerHTML = hljs.highlight(source, { language: grammar }).value
    else code.textContent = source
    html = `<pre class="hljs">${code.outerHTML}</pre>`
  }
  return sanitizeRenderedHtml(html)
}

export function sanitizeRenderedHtml(html: string): string {
  // DOMPurify removes foreignObject children; sanitize their HTML separately.
  const container = document.createElement('div')
  container.innerHTML = html
  const labels = Array.from(container.querySelectorAll('foreignObject'), (element, index) => {
    const label = document.createElement('div')
    label.innerHTML = DOMPurify.sanitize(element.innerHTML, {
      ALLOWED_TAGS: ['div', 'span', 'p', 'strong', 'em', 'b', 'i', 'br'],
      ALLOWED_ATTR: ['class', 'style', 'xmlns'],
      ALLOW_DATA_ATTR: false,
    })
    for (const child of label.querySelectorAll<HTMLElement>('[style]')) {
      for (const name of Array.from(child.style)) {
        const value = child.style.getPropertyValue(name)
        if (!/^(?:display|white-space|color|font-family|font-size|line-height|text-align|padding|margin|width|height)$/.test(name) || /[\\;{}]|url\s*\(|expression\s*\(/i.test(value))
          child.style.removeProperty(name)
      }
    }
    const safe = label.innerHTML
    element.replaceChildren()
    element.setAttribute('data-label-index', String(index))
    return safe
  })
  container.innerHTML = DOMPurify.sanitize(container.innerHTML, { ADD_TAGS: ['foreignObject'], ADD_ATTR: ['xmlns'] })
  for (const element of container.querySelectorAll('foreignObject[data-label-index]')) {
    const label = document.createElement('div')
    label.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
    label.innerHTML = labels[Number(element.getAttribute('data-label-index'))] ?? ''
    element.removeAttribute('data-label-index')
    element.append(label)
  }
  return container.innerHTML
}

export function createSourcePreview(onChange: (state: SourcePreviewState) => void, render = renderSourcePreview) {
  let version = 0
  let disposed = false
  let html = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    update(input: SourcePreviewInput) {
      if (disposed)
        return
      const current = ++version
      clearTimeout(timer)
      onChange({ html, error: '', status: 'loading' })
      timer = setTimeout(async () => {
        try {
          const result = await render(input)
          if (disposed || current !== version)
            return
          html = result
          onChange({ html, error: '', status: 'ready' })
        }
        catch (error) {
          if (!disposed && current === version)
            onChange({ html, error: error instanceof Error ? error.message : String(error), status: 'error' })
        }
      }, 300)
    },
    dispose() { disposed = true; clearTimeout(timer) },
  }
}
