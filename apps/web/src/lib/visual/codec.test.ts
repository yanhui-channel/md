// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core'
import { generateHTML, getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createVisualCodec } from './codec'

const text = (node: JSONContent): string => node.text ?? (node.content ?? []).map(text).join('')

describe('visual Markdown codec', () => {
  it.each(['> ```sql\n> SELECT 3;\n> ```', '- item\n\n  ```java\n  class Demo {}\n  ```', '> ```html\n> <div>content</div>\n> ```', '- item\n\n  ```bash\n  echo "$HOME"\n  ```'])('restores nested code as editable source blocks: %s', (source) => {
    const codec = createVisualCodec()
    const doc = codec.parse(source)
    const walk = (node: JSONContent): JSONContent[] => [node, ...(node.content ?? []).flatMap(walk)]
    const blocks = walk(doc)
    expect(blocks.some(node => node.type === 'sourceBlock' && node.attrs?.kind === 'code')).toBe(true)
    expect(blocks.some(node => node.type === 'codeBlock')).toBe(false)
    expect(codec.parse(codec.serialize(doc))).toEqual(doc)
  })
  it('persists a changed code language even when the source is unchanged', () => {
    const codec = createVisualCodec()
    const doc = codec.parse('```js\n  const n = 1;\n```')
    doc.content![0].attrs!.language = 'typescript'
    const serialized = codec.serialize(doc)
    expect(serialized).toBe('```typescript\n  const n = 1;\n```')
    expect(codec.parse(serialized).content![0].attrs!.language).toBe('typescript')
  })
  it.each(['code', 'mermaid', 'math', 'raw'])('keeps nested %s sources through quote and styled quote round trips', (kind) => {
    const codec = createVisualCodec()
    const source = kind === 'math' ? '$$\nx^2\n$$' : kind === 'raw' ? '<custom-card>keep</custom-card>' : `\`\`\`${kind === 'mermaid' ? 'mermaid' : 'js'}\nconst keep = 1\n\`\`\``
    const block = codec.parse(source).content![0]
    const doc = { type: 'doc', content: [{ type: 'blockquote', content: [block] }] }
    const encoded = codec.serialize(doc)
    expect(encoded).toContain(kind === 'math' ? 'x^2' : kind === 'raw' ? 'keep' : 'const keep = 1')
    expect(codec.serialize(codec.parse(encoded))).toBe(encoded)
    doc.content[0] = { ...doc.content[0], attrs: { lineHeight: '2' } } as any
    const styled = codec.serialize(doc)
    const restored = codec.parse(styled)
    expect(restored.content![0].content![0]).toMatchObject({ type: 'sourceBlock', attrs: { kind, source: block.attrs!.source } })
    expect(codec.serialize(restored)).toBe(styled)
  })
  it('roundTripsPlainTextAndNestedLists', () => {
    const codec = createVisualCodec()
    const source = '# 标题\n\n中文 **重点** 和 [链接](https://example.com)\n\n- 第一项\n  - 子项目\n- 第二项'
    const doc = codec.parse(source)
    expect(text(doc)).toBe('标题中文 重点 和 链接第一项子项目第二项')
    expect(doc.content?.map(n => n.type)).toEqual(['heading', 'paragraph', 'bulletList'])
    expect(codec.parse(codec.serialize(doc))).toEqual(doc)
    const once = codec.serialize(doc)
    expect(codec.serialize(codec.parse(once))).toBe(once)
  })

  it.each([
    '<custom-card id="a">不能丢</custom-card>',
    '注释[^a]\n\n[^a]: 引用原文',
    '- [x] 保留任务状态\n- [ ] 未完成',
    '::: custom-component\n原始内容\n:::',
    '[链接][id]\n\n[id]: https://example.com "引用"',
    '[id]\n\n[id]: https://example.com',
  ])('preservesUnknownRawBlocks: %s', (source) => {
    const codec = createVisualCodec()
    expect(codec.serialize(codec.parse(source))).toBe(source)
  })

  it('preservesFrontMatterWithoutTurningItIntoVisibleHeadings', () => {
    const codec = createVisualCodec()
    const source = '---\ntitle: 原标题\n---\n\n正文'
    const doc = codec.parse(source)
    expect(doc.content?.[0].type).toBe('sourceBlock')
    expect(doc.content?.[1].type).toBe('paragraph')
    expect(codec.serialize(doc)).toBe(source)
  })

  it('keepsDuplicateBlockOrder and edits only the selected block', () => {
    const codec = createVisualCodec()
    const doc = codec.parse('重复\n\n重复\n\n尾部')
    expect(doc.content).toHaveLength(3)
    doc.content![1].content![0].text = '第二处修改'
    expect(codec.serialize(doc)).toBe('重复\n\n第二处修改\n\n尾部')
  })

  it('keepsCodeWhitespace including blank lines and unknown fence languages', () => {
    const codec = createVisualCodec()
    const source = '```unknown\n  alpha\n\n  beta  \n```'
    const doc = codec.parse(source)
    expect(doc.content?.[0].type).toBe('sourceBlock')
    expect(doc.content?.[0].attrs?.source).toBe('  alpha\n\n  beta  ')
    expect(codec.serialize(doc)).toBe(source)
  })

  it('roundTripsInlineStylesAndTableWidths through controlled HTML', () => {
    const codec = createVisualCodec()
    const schema = getSchema(codec.extensions)
    const doc = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'paragraph', attrs: { textAlign: 'center', lineHeight: '2.2', blockSpacing: '24px' }, content: [
        { type: 'text', text: '局部样式', marks: [{ type: 'textStyle', attrs: { fontSize: '20px', color: '#4285f4' } }, { type: 'underline' }] },
      ] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colwidth: [180], align: 'right' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A|B' }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }] }] },
      ] }] },
      { type: 'image', attrs: { src: 'assets/test.png', alt: '配图', width: 220, align: 'right' } },
    ] }).toJSON()
    const encoded = codec.serialize(doc)
    expect(encoded).toContain('data-visual')
    const restored = codec.parse(encoded)
    expect(generateHTML(restored, codec.extensions)).toBe(generateHTML(doc, codec.extensions))
    expect(restored.content?.[1].content?.[0].content?.[0].attrs?.colwidth).toEqual([180])
    expect(restored.content?.[2].attrs).toMatchObject({ width: 220, align: 'right' })
  })

  it('doesNotExecuteImportedHtml while retaining raw source', () => {
    const codec = createVisualCodec()
    const raw = '<section onclick="alert(1)"><script>alert(1)</script>保留原文</section>'
    const doc = codec.parse(raw)
    expect(codec.serialize(doc)).toBe(raw)
    const dom = document.createElement('div')
    dom.innerHTML = generateHTML(doc, codec.extensions)
    expect(dom.querySelector('script,[onclick]')).toBeNull()
    expect(dom.textContent).toContain('保留原文')
  })

  it('retains unsafe Markdown links as inert raw source instead of losing text', () => {
    const codec = createVisualCodec()
    const raw = '[文字](javascript:alert)'
    const doc = codec.parse(raw)
    expect(codec.serialize(doc)).toBe(raw)
    expect(generateHTML(doc, codec.extensions)).not.toContain('href="javascript:')
  })
})
