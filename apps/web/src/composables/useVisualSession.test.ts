import type { DocumentSnapshot, SessionStatus } from '@/lib/visual/session'
// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history } from '@md/shared/editor'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisualCodec } from '@/lib/visual/codec'
import { createVisualSession } from '@/lib/visual/session'

const dispose: (() => void)[] = []
afterEach(() => { dispose.splice(0).forEach(fn => fn()) })

function setup(markdown = '# 原稿\n\n正文', save = async (_snapshot: DocumentSnapshot) => {}) {
  const codec = createVisualCodec()
  const source = new EditorView({ state: EditorState.create({ doc: markdown, extensions: [history()] }) })
  const visual = new Editor({ extensions: codec.extensions, content: '<p></p>' })
  const changes: DocumentSnapshot[] = []
  const statuses: SessionStatus[] = []
  const session = createVisualSession(visual, {
    source,
    codec,
    postId: 'original',
    title: () => '原稿',
    onChange: s => changes.push(s),
    save,
    onStatus: status => statuses.push(status),
  })
  dispose.push(() => { session.dispose(); source.destroy(); visual.destroy() })
  return { source, visual, session, changes, statuses }
}

describe('visual session', () => {
  it('retries pending visual content after source dispatch fails', async () => {
    const { visual, source, session } = setup('原稿')
    const dispatch = vi.spyOn(source, 'dispatch').mockImplementationOnce(() => { throw new Error('dispatch failed') })
    visual.commands.insertContentAt(3, '保留')
    expect(visual.getText()).toBe('原稿保留')
    dispatch.mockRestore()
    await session.flush()
    expect(source.state.doc.toString()).toBe('原稿保留')
  })
  it('keeps successive source-block replacements as separate undo steps', () => {
    const { visual, session } = setup('```mermaid\noriginal\n```')
    for (const content of ['valid change', 'invalid change']) {
      visual.view.dom.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText' }))
      visual.view.dispatch(visual.state.tr.setNodeMarkup(0, undefined, { ...visual.state.doc.firstChild!.attrs, source: content }).setMeta('visualHistoryBoundary', true))
    }
    session.undo()
    expect(session.snapshot().markdown).toContain('valid change')
    expect(session.snapshot().markdown).not.toContain('invalid change')
  })
  it('openingDoesNotRewriteMarkdown', () => {
    const original = '#   原稿\n\n文字  \n下一行\n'
    const { source, visual, changes } = setup(original)
    expect(source.state.doc.toString()).toBe(original)
    expect(visual.getText()).toContain('下一行')
    expect(changes).toHaveLength(0)
  })

  it('mirrorsEachChangeOnce', () => {
    const { source, visual, changes } = setup('原稿')
    visual.commands.insertContentAt(3, '新增')
    expect(source.state.doc.toString()).toBe('原稿新增')
    expect(changes).toHaveLength(1)
    source.dispatch({ changes: { from: 4, insert: '源码' } })
    expect(visual.getText()).toBe('原稿新增源码')
    expect(changes).toHaveLength(2)
  })

  it('undoAcrossBothEditors and typing after undo invalidates redo', () => {
    const { source, visual, session } = setup('原稿')
    visual.commands.insertContentAt(3, '一')
    source.dispatch({ changes: { from: 3, insert: '二' } })
    expect(session.undo()).toBe(true)
    expect(session.snapshot().markdown).toBe('原稿一')
    expect(session.undo()).toBe(true)
    expect(session.snapshot().markdown).toBe('原稿')
    expect(session.redo()).toBe(true)
    expect(visual.getText()).toBe('原稿一')
    visual.commands.insertContentAt(4, '新内容')
    expect(session.redo()).toBe(false)
  })

  it('compositionSurvivesPostSwitch', () => {
    const { source, visual, session } = setup('原稿')
    visual.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    visual.commands.insertContentAt(3, '中文输入')
    expect(source.state.doc.toString()).toBe('原稿')
    session.commitPending(true)
    session.dispose()
    expect(source.state.doc.toString()).toBe('原稿中文输入')
  })

  it('rejectsStalePostUpdate after disposal', () => {
    const { source, visual, session, changes } = setup('旧文章')
    session.dispose()
    visual.commands.insertContentAt(4, '延迟事件')
    expect(source.state.doc.toString()).toBe('旧文章')
    expect(changes).toHaveLength(0)
  })

  it('saveFailureKeepsUnsavedDraft', async () => {
    const { source, visual, session, statuses } = setup('原稿', async () => { throw new Error('quota') })
    visual.commands.insertContentAt(3, '不能丢')
    await expect(session.flush()).rejects.toThrow('quota')
    expect(source.state.doc.toString()).toBe('原稿不能丢')
    expect(visual.getText()).toBe('原稿不能丢')
    expect(statuses[statuses.length - 1]).toBe('error')
    expect(session.capture().markdown).toBe('原稿不能丢')
  })

  it('a stale save completion cannot mark newer input saved', async () => {
    let finish!: () => void
    const { visual, session, statuses } = setup('原稿', () => new Promise<void>((resolve) => { finish = resolve }))
    visual.commands.insertContentAt(3, '一')
    const saving = session.flush()
    visual.commands.insertContentAt(4, '二')
    finish()
    await saving
    expect(statuses[statuses.length - 1]).toBe('editing')
    expect(session.snapshot().markdown).toBe('原稿一二')
  })

  it('conflicting composition retains both versions instead of overwriting', async () => {
    const { source, visual, session } = setup('原稿')
    visual.view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    visual.commands.insertContentAt(3, '中文')
    source.dispatch({ changes: { from: 2, insert: '源码' } })
    await expect(session.flush()).rejects.toThrow('visual.conflictingInput')
    expect(() => session.capture()).toThrow('visual.conflictingInput')
    expect(source.state.doc.toString()).toBe('原稿源码')
    expect(visual.getText()).toBe('原稿中文')
  })

  it('undo restores image node selection instead of a text range', () => {
    const { visual, session } = setup('![sample](https://example.test/a.png)')
    visual.commands.setNodeSelection(0)
    visual.commands.updateAttributes('image', { width: 200 })
    session.undo()
    expect(visual.state.selection.toJSON()).toEqual({ type: 'node', anchor: 0 })
    session.redo()
    expect(visual.state.selection.toJSON()).toEqual({ type: 'node', anchor: 0 })
  })
})
