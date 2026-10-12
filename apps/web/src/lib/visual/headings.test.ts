import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createVisualCodec } from './codec'
import { articleHeadingDecorations, backspaceHeadingPrefix } from './headings'

describe('visual heading decorations', () => {
  it('separates the leading title without changing the stored document', () => {
    const codec = createVisualCodec()
    const editor = new Editor({ extensions: codec.extensions, content: codec.parse('# 文章\n\n# 8. 开始\n\n## 8.1 子节\n\n# 结束') })
    const before = editor.getJSON()
    const result = articleHeadingDecorations(editor.state.doc)
    expect(result.titleEnd).toBe(4)
    expect(result.decorations.length).toBeGreaterThan(4)
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })
  it('does not treat a later H1 as an article title or decorate quoted headings', () => {
    const codec = createVisualCodec()
    const editor = new Editor({ extensions: codec.extensions, content: codec.parse('引言\n\n# 开始\n\n> # 引用') })
    const result = articleHeadingDecorations(editor.state.doc)
    expect(result.titleEnd).toBe(0)
    expect(result.decorations).toHaveLength(3)
    editor.destroy()
  })

  it('deletes a visible heading boundary in the model without persisting decorative numbers', () => {
    const codec = createVisualCodec()
    const editor = new Editor({ extensions: codec.extensions, content: codec.parse('# Title\n\n# 8. Chapter') })
    editor.commands.setTextSelection(11)
    expect(backspaceHeadingPrefix(editor)).toBe(true)
    expect(editor.state.doc.textContent).toBe('TitleChapter')
    expect(codec.serialize(editor.getJSON())).toBe('# TitleChapter')
    editor.destroy()
  })
})
