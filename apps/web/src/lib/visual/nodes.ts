import { Extension, mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { safeStyleValue } from './style'

export function sourceMarkdown(attrs: Record<string, any>): string {
  if (attrs.source === attrs.originalSource && attrs.raw && (attrs.kind !== 'code' || attrs.language === attrs.originalLanguage))
    return String(attrs.raw)
  if (attrs.kind === 'raw')
    return String(attrs.source)
  if (attrs.kind === 'math')
    return `$$\n${attrs.source}\n$$`
  const runs = String(attrs.source).match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)))
  return `${fence}${String(attrs.language).replace(/[\r\n]/g, '')}\n${attrs.source}\n${fence}`
}

export const SourceBlock = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      kind: { default: 'raw' },
      source: { default: '' },
      language: { default: '' },
      raw: { default: '' },
      originalSource: { default: '' },
      originalLanguage: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'pre[data-source-block]', priority: 100, getAttrs: (element) => {
      try {
        const attrs = JSON.parse(element.getAttribute('data-source-block')!)
        if (!['raw', 'code', 'mermaid', 'math'].includes(attrs.kind) || ['source', 'language', 'raw', 'originalSource'].some(key => typeof attrs[key] !== 'string'))
          return false
        return attrs
      }
      catch { return false }
    } }]
  },
  renderMarkdown(node) { return sourceMarkdown(node.attrs ?? {}) },
  renderHTML({ node }) {
    return ['pre', { 'class': 'visual-source-fallback', 'data-source-block': JSON.stringify(node.attrs) }, ['code', {}, node.attrs.source]]
  },
})

const BlockSpacing = Extension.create({
  name: 'visualBlockSpacing',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'blockquote'],
      attributes: Object.fromEntries([
        ['lineHeight', 'line-height'],
        ['blockSpacing', 'margin-bottom'],
      ].map(([attr, css]) => [attr, {
        default: null,
        parseHTML: (el: HTMLElement) => safeStyleValue(css, el.style.getPropertyValue(css)),
        renderHTML: (attrs: Record<string, string>) => {
          const value = attrs[attr] && safeStyleValue(css, attrs[attr])
          return value ? { style: `${css}:${value}` } : {}
        },
      }])),
    }]
  },
})

export const VisualImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const width = Number(el.getAttribute('width'))
          return width >= 24 && width <= 2400 ? width : null
        },
      },
      align: {
        default: 'center',
        parseHTML: el => ['left', 'right'].includes(el.getAttribute('align') ?? '') ? el.getAttribute('align') : 'center',
        renderHTML: attrs => ({ align: attrs.align }),
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const align = HTMLAttributes.align
    const width = Number(HTMLAttributes.width)
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      style: `display:block;height:auto;max-width:100%;${width > 0 ? `width:${width}px;` : ''}margin-left:${align === 'left' ? '0' : 'auto'};margin-right:${align === 'right' ? '0' : 'auto'}`,
    })]
  },
})

export function visualExtensions() {
  return [
    StarterKit.configure({ undoRedo: false, trailingNode: false, link: { openOnClick: false, autolink: false } }),
    TextStyle,
    Color,
    FontSize,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    BlockSpacing,
    VisualImage,
    Table.configure({ resizable: true, cellMinWidth: 60 }),
    TableRow,
    TableHeader.extend({ content: 'paragraph' }),
    TableCell.extend({ content: 'paragraph' }),
    SourceBlock,
  ]
}
