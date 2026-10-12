import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Decoration } from '@tiptap/pm/view'
import { headingAttributes, headingOutline } from '@/yanhui/decorate'

export function backspaceHeadingPrefix(editor: Editor): boolean {
  const { selection, doc } = editor.state
  const { $from } = selection
  if (!selection.empty || $from.depth !== 1 || $from.parent.type.name !== 'heading')
    return false
  const { prefixLength } = headingOutline([{ level: $from.parent.attrs.level, text: $from.parent.textContent }])[0]!
  if ($from.parentOffset > prefixLength)
    return false
  if (articleHeadingDecorations(doc).titleEnd === $from.after())
    return false
  // Native deletion beside a noneditable widget can copy its text into the model.
  const joined = editor.chain().deleteRange({ from: $from.start(), to: $from.start() + prefixLength }).setTextSelection($from.start()).joinBackward().run()
  return joined || prefixLength > 0
}

export function articleHeadingDecorations(doc: Node) {
  const headings: { node: Node, offset: number, level: number, text: string, title: boolean }[] = []
  let leading = true
  let titleEnd = 0
  doc.forEach((node, offset) => {
    if ((node.type.name === 'paragraph' && !node.content.size)
      || (offset === 0 && node.type.name === 'sourceBlock' && /^---\r?\n/.test(node.attrs.source))) {
      return
    }
    if (node.type.name === 'heading') {
      const title = leading && node.attrs.level === 1
      headings.push({ node, offset, level: node.attrs.level, text: node.textContent, title })
      if (title)
        titleEnd = offset + node.nodeSize
    }
    leading = false
  })
  const outline = headingOutline(headings)
  const decorations: Decoration[] = []
  headings.forEach(({ node, offset, title }, index) => {
    if (title) {
      decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: 'yh-article-title' }))
      decorations.push(Decoration.widget(offset, () => {
        const label = document.createElement('div')
        label.className = 'yh-title-label'
        label.textContent = '文章标题'
        label.contentEditable = 'false'
        return label
      }, { side: -1, key: 'article-title-label' }))
      return
    }
    const heading = outline[index]!
    decorations.push(Decoration.node(offset, offset + node.nodeSize, headingAttributes(heading)))
    // Keep authored prefixes in Markdown; only replace their display with the live number.
    if (heading.prefixLength)
      decorations.push(Decoration.inline(offset + 1, offset + 1 + heading.prefixLength, { class: 'yh-authored-number', style: 'display: none;' }))
    decorations.push(Decoration.widget(offset + 1 + heading.prefixLength, () => {
      const marker = document.createElement('span')
      marker.className = 'yh-heading-marker'
      marker.textContent = `${heading.number} `
      marker.style.width = heading.width
      marker.style.marginLeft = `-${heading.width}`
      marker.contentEditable = 'false'
      return marker
    }, { side: -1, key: `heading-number-${heading.number}` }))
    if (heading.depth === 1) {
      decorations.push(Decoration.widget(offset + node.nodeSize - 1, () => {
        const line = document.createElement('span')
        line.className = 'yh-heading-line'
        line.contentEditable = 'false'
        return line
      }, { side: 1, key: `heading-line-${heading.number}` }))
    }
  })
  return { decorations, titleEnd }
}
