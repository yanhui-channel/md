import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import { t } from '@/i18n/translate'
import { createVisualCodec } from '@/lib/visual/codec'
import { createVisualSession } from '@/lib/visual/session'
import { documentRepo } from '@/storage'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'

export function useVisualSession(visual: Editor) {
  const editorStore = useEditorStore()
  const postStore = usePostStore()
  const source = editorStore.editor
  const postId = editorStore.sourcePostId
  if (!source || !postId)
    throw new Error('visual.notReady')
  const session = createVisualSession(visual, {
    source: toRaw(source) as EditorView,
    codec: createVisualCodec(),
    postId,
    title: () => postStore.getPostById(postId)?.title ?? '',
    onChange: snapshot => postStore.updatePostContent(snapshot.postId, snapshot.markdown),
    save: async (snapshot) => {
      const post = postStore.getPostById(snapshot.postId)
      if (!post)
        throw new Error('visual.postMissing')
      await documentRepo.savePost({ ...post, content: snapshot.markdown })
    },
    onStatus: (status, error) => {
      editorStore.visualStatus = status
      const message = error instanceof Error ? error.message : error ? String(error) : ''
      editorStore.visualError = message.startsWith('visual.') ? t(message) : message
    },
  })
  editorStore.visualEditor = visual
  editorStore.visualSession = session
  void session.flush().catch(() => {})
  return session
}
