import type { Editor } from '@tiptap/core'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { safeVisualUrl } from './style'

export function insertVisualCodeBlock(editor: Editor): boolean {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection || selection instanceof AllSelection) || editor.isActive('table'))
    return false
  let textOnly = true
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isAtom && !node.isText && node.type.name !== 'hardBreak')
      textOnly = false
    if (node.type.name === 'table')
      textOnly = false
  })
  if (!textOnly)
    return false
  const source = doc.textBetween(selection.from, selection.to, '\n', '\n')
  const block = editor.schema.nodes.sourceBlock.create({ kind: 'code', language: 'plaintext', source })
  const tr = editor.state.tr.replaceRangeWith(selection.from, selection.to, block)
  let position: number | undefined
  tr.doc.descendants((node, pos) => {
    if (node === block)
      position = pos
  })
  if (position === undefined)
    return false
  // Leave a text cursor destination when a code block is the last article node.
  if (position + block.nodeSize === tr.doc.content.size)
    tr.insert(tr.doc.content.size, editor.schema.nodes.paragraph.create())
  tr.setSelection(NodeSelection.create(tr.doc, position)).setMeta('visualHistoryBoundary', true)
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export function setColumnWidth(editor: Editor, width: number): boolean {
  if (!Number.isInteger(width) || width < 60 || width > 1200)
    return false
  const { $from } = editor.state.selection
  let depth = $from.depth
  while (depth > 0 && !['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) depth--
  if (!depth)
    return false
  const table = $from.node(depth - 2)
  const start = $from.start(depth - 2)
  const map = TableMap.get(table)
  const column = map.colCount($from.before(depth) - start)
  const positions = new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width + column]))
  const tr = editor.state.tr
  for (const offset of positions) {
    const cell = table.nodeAt(offset)!
    tr.setNodeMarkup(start + offset, undefined, { ...cell.attrs, colwidth: [width] })
  }
  editor.view.dispatch(tr)
  return true
}

export function updateSelectedImage(editor: Editor, attrs: { src?: string, width?: number, align?: string }): boolean {
  const selection = editor.state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image')
    return false
  if (attrs.src !== undefined && (!attrs.src.trim() || !safeVisualUrl(attrs.src)))
    return false
  if (attrs.width !== undefined && (!Number.isInteger(attrs.width) || attrs.width < 24 || attrs.width > 2400))
    return false
  if (attrs.align !== undefined && !['left', 'center', 'right'].includes(attrs.align))
    return false
  return editor.commands.updateAttributes('image', { ...attrs, height: null })
}
