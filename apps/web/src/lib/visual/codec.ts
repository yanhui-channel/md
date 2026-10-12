import type { Extensions, JSONContent } from '@tiptap/core'
import { parseFrontMatter } from '@md/core/utils'
import { generateHTML, getSchema } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { DOMParser } from '@tiptap/pm/model'
import { sourceMarkdown, visualExtensions } from './nodes'
import { safeVisualUrl, sanitizeVisualHtml } from './style'

export interface VisualCodec {
  extensions: Extensions
  parse: (markdown: string) => JSONContent
  serialize: (doc: JSONContent) => string
}

export function createVisualCodec(): VisualCodec {
  const extensions = visualExtensions()
  const manager = new MarkdownManager({ extensions, markedOptions: { gfm: true } })
  const schema = getSchema(extensions)
  const rawBlock = (raw: string, kind = 'raw', source = raw, language = ''): JSONContent => ({
    type: 'sourceBlock',
    attrs: { kind, source, language, raw, originalSource: source, originalLanguage: language },
  })
  const normalize = (doc: JSONContent) => {
    const sourceNodes = (node: JSONContent): JSONContent => {
      if (node.type === 'codeBlock') {
        const language = String(node.attrs?.language ?? '')
        return rawBlock('', language === 'mermaid' ? 'mermaid' : 'code', (node.content ?? []).map(child => child.text ?? '').join(''), language)
      }
      if (!node.content)
        return node
      const content = node.content.map(sourceNodes)
      if (node.type === 'listItem' && content[0]?.type !== 'paragraph')
        content.unshift({ type: 'paragraph' })
      return { ...node, content }
    }
    const node = schema.nodeFromJSON(sourceNodes(doc))
    node.check()
    return node.toJSON()
  }

  function parse(markdown: string): JSONContent {
    const content: JSONContent[] = []
    const { body } = parseFrontMatter(markdown)
    if (body !== markdown)
      content.push(rawBlock(markdown.slice(0, markdown.length - body.length)))
    const tokens = manager.instance.lexer(body)
    for (const token of tokens) {
      if (token.type === 'space')
        continue
      const raw = token.raw
      if (token.type === 'code') {
        const language = String(token.lang ?? '')
        content.push(rawBlock(raw, language === 'mermaid' ? 'mermaid' : 'code', String(token.text), language))
        continue
      }
      if (raw.startsWith('$$') && raw.trimEnd().endsWith('$$')) {
        content.push(rawBlock(raw, 'math', raw.trim().slice(2, -2).trim()))
        continue
      }
      if (token.type === 'html' && raw.startsWith('<section data-visual="1">')) {
        try {
          const container = document.createElement('div')
          container.innerHTML = sanitizeVisualHtml(raw)
          for (const block of [container, ...container.querySelectorAll('section,div,table,thead,tbody,tr,colgroup')]) {
            for (const child of Array.from(block.childNodes)) {
              if (child.nodeType === 3 && !child.textContent?.trim())
                child.remove()
            }
          }
          content.push(...(DOMParser.fromSchema(schema).parse(container, { preserveWhitespace: 'full' }).toJSON().content ?? []))
        }
        catch { content.push(rawBlock(raw)) }
        continue
      }
      // Protect extension syntax before the generic parser can flatten it.
      let protect = ['html', 'def'].includes(token.type)
      manager.instance.walkTokens([token], (child) => {
        if (child.type !== 'code' && child.type !== 'table' && !('tokens' in child) && !('items' in child)
          && /<\/?[a-z]|\[\^|\]\[|^:::|\$|==|\+\+|\{\{|^\[TOC\]/im.test(child.raw)) {
          protect = true
        }
        if ((child.type === 'list_item' && child.task) || child.type === 'html')
          protect = true
        if ((child.type === 'link' || child.type === 'image') && !safeVisualUrl(child.href))
          protect = true
        if ((child.type === 'link' || child.type === 'image') && /^!?\[/.test(child.raw) && !child.raw.includes(']('))
          protect = true
      })
      if (protect) {
        content.push(rawBlock(raw))
        continue
      }
      try {
        const parsed = normalize(manager.parse(raw.replace(/\n+$/, '')))
        content.push(...(parsed.content ?? []))
      }
      catch {
        content.push(rawBlock(raw))
      }
    }
    return normalize({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] })
  }

  function requiresHtml(node: JSONContent): boolean {
    const attrs = node.attrs ?? {}
    return Boolean(attrs.textAlign || attrs.lineHeight || attrs.blockSpacing || attrs.width || attrs.colwidth
      || (node.type === 'image' && attrs.align !== 'center')
      // List fences are not lossless through the Markdown manager's indentation rules.
      || (node.type === 'listItem' && node.content?.some(child => child.type === 'sourceBlock' && child.attrs?.kind === 'code'))
      || node.marks?.some(mark => ['textStyle', 'underline'].includes(mark.type))
      || node.content?.some(requiresHtml)
      || (node.type === 'table' && (!node.content?.[0]?.content?.every(cell => cell.type === 'tableHeader') || JSON.stringify(node).includes('hardBreak'))))
  }

  function serialize(doc: JSONContent): string {
    normalize(doc)
    const chunks = (doc.content ?? []).map((node) => {
      if (node.type === 'sourceBlock')
        return sourceMarkdown(node.attrs!)
      if (requiresHtml(node)) {
        const html = generateHTML({ type: 'doc', content: [node] }, extensions)
        return `<section data-visual="1">${sanitizeVisualHtml(html)}</section>`
      }
      return manager.serialize({ type: 'doc', content: [node] })
    })
    return chunks.reduce((result, chunk) => result ? `${result}${result.endsWith('\n\n') ? '' : result.endsWith('\n') ? '\n' : '\n\n'}${chunk}` : chunk, '')
  }
  return { extensions, parse, serialize }
}
