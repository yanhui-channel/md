import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import type { DocumentSnapshot, SessionStatus, VisualSession } from '@/lib/visual/session'
import type { Post } from '@/types/post'
import { t } from '@/i18n/translate'
import { createVisualCodec } from '@/lib/visual/codec'
import { saveLocalImages } from '@/lib/visual/image-edit'

/** CodeMirror editor instance and basic document operations. */
export const useEditorStore = defineStore(`editor`, () => {
  const editor = ref<EditorView | null>(null)
  const visualEditor = shallowRef<Editor | null>(null)
  const visualSession = shallowRef<VisualSession | null>(null)
  const sourcePostId = ref('')
  const activeTarget = ref<'source' | 'visual'>('source')
  const visualStatus = ref<SessionStatus>('saved')
  const visualError = ref('')
  const visualEditing = ref(true)

  async function addImages(files: File[], replace = false) {
    visualSession.value?.commitPending(true)
    return saveLocalImages(files, {
      postId: sourcePostId.value,
      currentPostId: () => sourcePostId.value,
      visual: activeTarget.value === 'visual' && visualEditing.value ? toRaw(visualEditor.value) ?? undefined : undefined,
      source: toRaw(editor.value) as EditorView | undefined,
    }, replace)
  }

  function detachVisualSession() {
    visualSession.value?.commitPending(true)
    visualSession.value?.dispose()
    visualSession.value = null
    visualEditor.value = null
  }

  let flushPendingContent: (() => void) | null = null

  function registerContentFlush(fn: () => void) {
    flushPendingContent = fn
  }

  function unregisterContentFlush() {
    flushPendingContent = null
  }

  /** Sync debounced editor content to post store (call before page refresh). */
  function flushContentToPostStore() {
    visualSession.value?.commitPending(true)
    flushPendingContent?.()
  }

  const formatContent = async () => {
    visualSession.value?.commitPending(true)
    if (!editor.value)
      return

    const source = toRaw(editor.value)
    const postId = sourcePostId.value
    const original = source.state.doc
    const { formatDoc } = await import('@md/shared/utils/formatDoc')
    const doc = await formatDoc(original.toString())
    if (toRaw(editor.value) !== source || sourcePostId.value !== postId || source.state.doc !== original)
      return
    source.dispatch({
      changes: { from: 0, to: original.length, insert: doc },
    })
    return doc
  }

  const importContent = (content: string) => {
    visualSession.value?.commitPending(true)
    if (!editor.value)
      return

    editor.value.dispatch({
      changes: { from: 0, to: editor.value.state.doc.length, insert: content },
    })
  }

  const clearContent = () => {
    visualSession.value?.commitPending(true)
    if (!editor.value)
      return

    editor.value.dispatch({
      changes: { from: 0, to: editor.value.state.doc.length, insert: `` },
    })
    toast.success(t('store.editor.contentCleared'))
  }

  const getContent = () => {
    return editor.value?.state.doc.toString() ?? ``
  }

  function captureMarkdown(post: Pick<Post, 'id' | 'title' | 'content'>): DocumentSnapshot {
    let markdown = post.content
    if (post.id === sourcePostId.value) {
      if (visualSession.value)
        return visualSession.value.capture()
      markdown = editor.value ? getContent() : post.content
      toast.warning('可视化编辑暂不可用，已使用左侧 Markdown 原文')
    }
    return { postId: post.id, title: post.title, revision: 0, markdown }
  }

  const getSelection = () => {
    if (activeTarget.value === 'visual' && visualEditor.value) {
      const { from, to } = visualEditor.value.state.selection
      return visualEditor.value.state.doc.textBetween(from, to, '\n')
    }
    if (!editor.value)
      return ``

    const selection = editor.value.state.selection.main
    return editor.value.state.doc.sliceString(selection.from, selection.to)
  }

  const replaceSelection = (text: string) => {
    if (activeTarget.value === 'visual' && visualEditor.value) {
      const chain = visualEditor.value.chain().focus()
      if (text)
        chain.insertContent({ type: 'text', text }).run()
      else chain.deleteSelection().run()
      return
    }
    if (!editor.value)
      return

    editor.value.dispatch(editor.value.state.replaceSelection(text))
  }

  const replaceText = (oldText: string, newText: string) => {
    if (!editor.value || !oldText)
      return false

    const content = editor.value.state.doc.toString()
    const cursor = editor.value.state.selection.main.head

    let bestFrom = -1
    let bestDist = Infinity
    let pos = 0
    while (true) {
      const idx = content.indexOf(oldText, pos)
      if (idx === -1)
        break
      const dist = Math.abs(idx - cursor)
      if (dist < bestDist) {
        bestDist = dist
        bestFrom = idx
      }
      pos = idx + 1
    }

    if (bestFrom === -1)
      return false

    editor.value.dispatch({
      changes: { from: bestFrom, to: bestFrom + oldText.length, insert: newText },
    })
    editor.value.focus()
    return true
  }

  const insertAtCursor = (text: string) => {
    if (activeTarget.value === 'visual' && visualEditor.value) {
      visualEditor.value.chain().focus().insertContent(createVisualCodec().parse(text).content ?? []).run()
      return
    }
    if (!editor.value)
      return

    const selection = editor.value.state.selection.main
    editor.value.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    })
    editor.value.focus()
  }

  return {
    editor,
    visualEditor,
    visualSession,
    sourcePostId,
    activeTarget,
    visualStatus,
    visualError,
    visualEditing,
    addImages,
    detachVisualSession,
    registerContentFlush,
    unregisterContentFlush,
    flushContentToPostStore,
    formatContent,
    importContent,
    clearContent,
    getContent,
    captureMarkdown,
    getSelection,
    replaceSelection,
    replaceText,
    insertAtCursor,
  }
})
