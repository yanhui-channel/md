import type { JSONContent } from '@tiptap/core'
// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createVisualCodec } from './codec'
import { setColumnWidth, updateSelectedImage } from './objects'
import * as objects from './objects'

const codec = createVisualCodec()
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))
function setup(content: string) {
  const editor = new Editor({ extensions: codec.extensions, content: codec.parse(content) })
  editors.push(editor)
  return editor
}
const table = '| A | B |\n| --- | --- |\n| x | y |'
function firstCell(editor: Editor) {
  let pos: number | undefined
  editor.state.doc.descendants((node, offset) => {
    if (pos === undefined && node.type.name === 'tableHeader')
      pos = offset + 2
  })
  editor.commands.setTextSelection(pos!)
}
function roundTrip(editor: Editor) {
  expect(codec.parse(codec.serialize(editor.getJSON()))).toEqual(editor.getJSON())
}
describe('inline objects', () => {
  it.each([
    ['- first\n- second', 'bulletList', 'first', 0],
    ['- first\n- second', 'bulletList', 'second', 1],
    ['1. first\n2. second', 'orderedList', 'first', 0],
    ['1. first\n2. second', 'orderedList', 'second', 1],
  ])('keeps code converted from %s / %s / %s exact across repeated reloads', (markdown, listType, selected, index) => {
    const editor = setup(markdown)
    let start = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === selected)
        start = pos + 1
    })
    editor.commands.setTextSelection({ from: start, to: start + selected.length })
    expect(objects.insertVisualCodeBlock(editor)).toBe(true)
    const serialized = codec.serialize(editor.getJSON())
    let restored: JSONContent = editor.getJSON()
    for (let reload = 0; reload < 2; reload++) {
      restored = codec.parse(codec.serialize(restored))
      expect(restored.content![0].type).toBe(listType)
      expect(restored.content![0].content![index].content!.find(node => node.type === 'sourceBlock')?.attrs).toMatchObject({ kind: 'code', language: 'plaintext', source: selected })
      expect(codec.serialize(restored)).toBe(serialized)
    }
  })
  it('converts select-all text without changing any characters', () => {
    const editor = setup('first\n\nsecond')
    editor.commands.selectAll()
    expect(objects.insertVisualCodeBlock(editor)).toBe(true)
    expect(editor.getJSON().content![0]).toMatchObject({ type: 'sourceBlock', attrs: { source: 'first\nsecond' } })
  })
  it('inserts an empty code block at the cursor without replacing adjacent text', () => {
    const editor = setup('Before\n\nAfter')
    editor.commands.setTextSelection(7)
    expect(objects.insertVisualCodeBlock).toBeTypeOf('function')
    expect(objects.insertVisualCodeBlock(editor)).toBe(true)
    const content = codec.serialize(editor.getJSON())
    expect(content).toContain('Before')
    expect(content).toContain('After')
    expect(editor.getJSON().content!.some(node => node.type === 'sourceBlock' && node.attrs!.kind === 'code')).toBe(true)
  })
  it('turns only selected text into code and preserves hard breaks and indentation', () => {
    const editor = setup('Before\n\n  first  \nsecond\n\nAfter')
    const start = editor.state.doc.firstChild!.nodeSize + 1
    const paragraph = editor.state.doc.child(1)
    const expected = paragraph.textBetween(0, paragraph.content.size, '\n', '\n')
    editor.commands.setTextSelection({ from: start, to: start + paragraph.content.size })
    expect(objects.insertVisualCodeBlock).toBeTypeOf('function')
    expect(objects.insertVisualCodeBlock(editor)).toBe(true)
    const blocks = editor.getJSON().content!
    expect(blocks.find(node => node.type === 'sourceBlock')?.attrs!.source).toBe(expected)
    expect(codec.serialize(editor.getJSON())).toContain('After')
  })
  it('does not destroy images or tables when converting a mixed selection', () => {
    const editor = setup('Before\n\n![sample](https://example.test/a.png)\n\nAfter')
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
    const before = editor.getJSON()
    expect(objects.insertVisualCodeBlock).toBeTypeOf('function')
    expect(objects.insertVisualCodeBlock(editor)).toBe(false)
    expect(editor.getJSON()).toEqual(before)
    const cells = setup(table)
    firstCell(cells)
    expect(objects.insertVisualCodeBlock(cells)).toBe(false)
  })
  it('cellWithPipesAndBreaksRoundTrips with empty cells and headings', () => {
    const editor = setup(table)
    firstCell(editor)
    editor.commands.insertContent(' | inner')
    editor.commands.setHardBreak()
    editor.commands.insertContent('next')
    roundTrip(editor)
    expect(editor.getHTML()).toContain('<br>')
  })
  it('insertDeleteRowsAndColumns', () => {
    const editor = setup(table)
    firstCell(editor)
    expect(editor.commands.addRowAfter()).toBe(true)
    expect(editor.commands.addColumnAfter()).toBe(true)
    roundTrip(editor)
    expect(editor.commands.deleteColumn()).toBe(true)
    expect(editor.commands.deleteRow()).toBe(true)
    roundTrip(editor)
  })
  it('columnWidthSurvivesReload and applies to every row in the column', () => {
    const editor = setup(table)
    firstCell(editor)
    expect(setColumnWidth(editor, 180)).toBe(true)
    roundTrip(editor)
    const rows = (editor.getJSON() as JSONContent).content![0].content!
    expect(rows.map(row => row.content![0].attrs!.colwidth)).toEqual([[180], [180]])
    expect(rows.map(row => row.content![1].attrs!.colwidth)).toEqual([null, null])
    const original = editor.getJSON()
    expect(setColumnWidth(editor, -10)).toBe(false)
    expect(editor.getJSON()).toEqual(original)
  })
  it('resizePreservesAspectRatio and replaceImageKeepsLayout', () => {
    const editor = setup('![sample](https://example.test/a.png)')
    expect(editor.state.doc.firstChild!.type.name).toBe('image')
    editor.commands.setNodeSelection(0)
    expect(updateSelectedImage(editor, { width: 240, align: 'right' })).toBe(true)
    expect(updateSelectedImage(editor, { src: 'https://example.test/b.png' })).toBe(true)
    expect(editor.getAttributes('image')).toMatchObject({ width: 240, height: null, align: 'right' })
    expect(editor.getHTML()).toContain('height: auto')
    roundTrip(editor)
  })
  it('duplicateImageSelectionIsPrecise and unsafe input is rejected', () => {
    const editor = setup('![same](https://example.test/a.png)\n\n![same](https://example.test/a.png)')
    const offset = editor.state.doc.firstChild!.nodeSize
    editor.commands.setNodeSelection(offset)
    expect(updateSelectedImage(editor, { width: 160 })).toBe(true)
    expect(editor.getJSON().content!.map(n => n.attrs!.width)).toEqual([null, 160])
    const before = editor.getJSON()
    expect(updateSelectedImage(editor, { src: 'javascript:alert(1)' })).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })
})
