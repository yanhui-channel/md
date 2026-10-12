// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { markRaw, ref, shallowRef, toRaw } from 'vue'

const format = vi.hoisted(() => vi.fn())
vi.mock('@md/shared/utils/formatDoc', () => ({ formatDoc: format }))
vi.mock('@/i18n/translate', () => ({ t: (key: string) => key }))
beforeAll(() => {
  for (const [name, value] of Object.entries({ defineStore, ref, shallowRef, toRaw, toast: { warning: vi.fn() } })) vi.stubGlobal(name, value)
})
afterAll(() => vi.unstubAllGlobals())
describe('asynchronous formatting', () => {
  it('captures the latest Markdown without persistence, safely falls back without a session, and blocks conflicts', async () => {
    setActivePinia(createPinia())
    const store = (await import('./editor')).useEditorStore()
    const view = new EditorView({ state: EditorState.create({ doc: 'latest source' }) })
    store.editor = markRaw(view); store.sourcePostId = 'first'
    const post = { id: 'first', title: '稿件', content: 'stale cached' }
    const latest = { postId: 'first', title: '稿件', markdown: 'latest visual', revision: 1 }
    const capture = vi.fn(() => latest)
    const flush = vi.fn(() => { throw new Error('quota') })
    store.visualSession = { capture, flush } as any
    try {
      expect(store.captureMarkdown(post)).toEqual(latest)
      expect(flush).not.toHaveBeenCalled()
      capture.mockImplementation(() => { throw new Error('conflictingInput') })
      expect(() => store.captureMarkdown(post)).toThrow('conflictingInput')
      store.visualSession = null
      expect(store.captureMarkdown(post).markdown).toBe('latest source')
      expect(toast.warning).toHaveBeenCalled()
      expect(store.captureMarkdown({ ...post, id: 'other' }).markdown).toBe('stale cached')
    }
    finally { view.destroy() }
  })
  it.each(['post', 'content'])('does not overwrite a changed %s while the formatter is working', async (change) => {
    setActivePinia(createPinia())
    const { useEditorStore } = await import('./editor')
    const store = useEditorStore()
    const view = new EditorView({ state: EditorState.create({ doc: 'before' }) })
    store.editor = markRaw(view); store.sourcePostId = 'first'
    let finish!: (value: string) => void
    format.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
    try {
      const pending = store.formatContent()
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      if (change === 'post')
        store.sourcePostId = 'second'
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'new content' } })
      finish('formatted old content')
      await pending
      expect(view.state.doc.toString()).toBe('new content')
    }
    finally { view.destroy() }
  })
})
