// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Editor } from '@tiptap/core'
import { expect, it, vi } from 'vitest'
import { createVisualCodec } from './codec'
import { createVisualSession } from './session'

it('exposesCompositionAndDoesNotFlushAnUnfinishedCandidate', async () => {
  const codec = createVisualCodec()
  const source = new EditorView({ state: EditorState.create({ doc: 'first' }) })
  const visual = new Editor({ extensions: codec.extensions })
  const save = vi.fn(async () => {})
  const session = createVisualSession(visual, { source, codec, postId: 'a', title: () => 'A', onChange: vi.fn(), onStatus: vi.fn(), save })
  try {
    visual.view.dom.dispatchEvent(new Event('compositionstart'))
    expect(session.isComposing()).toBe(true)
    await expect(session.flush()).rejects.toThrow('composition_active')
    expect(save).not.toHaveBeenCalled()
    visual.view.dom.dispatchEvent(new Event('compositionend'))
    await Promise.resolve()
    expect(session.isComposing()).toBe(false)
    await session.flush()
    expect(save).toHaveBeenCalledTimes(1)
  }
  finally { session.dispose(); source.destroy(); visual.destroy() }
})
