<script setup lang="ts">
import { Download, Eye, Pencil } from '@lucide/vue'
import { downloadFile } from '@md/shared/utils/fileHelpers'
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Editor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3'
import { useVisualSession } from '@/composables/useVisualSession'
import { collectClipboardImages } from '@/lib/upload/clipboard-images'
import { createVisualCodec } from '@/lib/visual/codec'
import { articleHeadingDecorations, backspaceHeadingPrefix } from '@/lib/visual/headings'
import { sanitizeVisualHtml } from '@/lib/visual/style'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'
import { YANHUI_THEME } from '@/yanhui/defaults'
import { assets } from '@/yanhui/resources'
import ImageNodeView from './ImageNodeView.vue'
import SourceNodeView from './SourceNodeView.vue'
import VisualToolbar from './VisualToolbar.vue'
import './visual.css'
import '@/yanhui/headings.css'

const { t } = useI18n()
const store = useEditorStore()
const theme = useThemeStore()
const editor = shallowRef<Editor>()
function handleHeadingBackspace(event: KeyboardEvent | InputEvent) {
  if (!editor.value || event.isComposing || (theme.theme !== YANHUI_THEME && !theme.theme.startsWith('bundle:')))
    return false
  if (!backspaceHeadingPrefix(editor.value))
    return false
  event.preventDefault()
  return true
}
function addImages(files: File[]) {
  store.activeTarget = 'visual'
  void store.addImages(files).catch(error => toast.error(t(error.message, { maxSize: 10 })))
}
const brand = Extension.create({
  name: 'yanhuiBrand',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      if (theme.theme !== YANHUI_THEME && !theme.theme.startsWith('bundle:'))
        return DecorationSet.empty
      const { decorations, titleEnd } = articleHeadingDecorations(state.doc)
      return DecorationSet.create(state.doc, [...decorations, Decoration.widget(titleEnd, () => {
        const el = document.createElement('div')
        el.className = 'visual-brand'
        el.contentEditable = 'false'
        const image = document.createElement('img')
        image.src = assets.avatar
        image.alt = ''
        el.append(image, document.createTextNode('衍辉 channel'))
        return el
      }, { key: 'yanhui-brand', side: -1 })])
    } } })]
  },
})

watch(() => theme.theme, () => {
  if (editor.value)
    editor.value.view.updateState(editor.value.state)
})

watch(() => [store.editor, store.sourcePostId] as const, ([source, postId]) => {
  if (!source || !postId)
    return
  store.visualSession?.dispose()
  store.visualSession = null
  store.visualEditor = null
  editor.value?.destroy()
  editor.value = undefined
  try {
    const codec = createVisualCodec()
    const instance = new Editor({
      extensions: [...codec.extensions.map(extension => extension.name === 'sourceBlock'
        ? extension.extend({ addNodeView() { return VueNodeViewRenderer(SourceNodeView) } })
        : extension.name === 'image' ? extension.extend({ addNodeView() { return VueNodeViewRenderer(ImageNodeView) } }) : extension), brand],
      content: codec.parse(source.state.doc.toString()),
      editorProps: {
        attributes: { 'role': 'textbox', 'aria-label': t('visual.body'), 'aria-multiline': 'true', 'spellcheck': 'false' },
        transformPastedHTML: sanitizeVisualHtml,
        handleKeyDown(_view, event) {
          return event.key === 'Backspace' && handleHeadingBackspace(event)
        },
        handlePaste(_view, event) {
          const files = collectClipboardImages(event.clipboardData)
          if (!files.length)
            return false
          event.preventDefault()
          addImages(files)
          return true
        },
        handleDrop(view, event) {
          const files = collectClipboardImages(event.dataTransfer)
          if (!files.length)
            return false
          event.preventDefault()
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          if (pos !== undefined)
            instance.commands.setTextSelection(pos)
          addImages(files)
          return true
        },
        handleDOMEvents: {
          beforeinput(_view, event) {
            return event.inputType === 'deleteContentBackward' && handleHeadingBackspace(event)
          },
          mousedown(view, event) {
            const target = event.target
            if (!(target instanceof HTMLImageElement) || target.closest('.visual-brand'))
              return false
            const pos = view.posAtDOM(target, 0)
            if (view.state.doc.nodeAt(pos)?.type.name !== 'image')
              return false
            event.preventDefault()
            view.focus()
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
            return true
          },
        },
      },
      onFocus: () => { store.activeTarget = 'visual' },
    })
    editor.value = instance
    useVisualSession(instance)
  }
  catch (error) {
    store.visualStatus = 'error'
    store.visualError = error instanceof Error ? error.message : String(error)
  }
}, { immediate: true, flush: 'post' })

function rescue() {
  downloadFile(JSON.stringify({ version: 1, document: editor.value?.getJSON(), source: store.getContent() }, null, 2), 'article-rescue.json', 'application/json')
}

onBeforeUnmount(() => {
  store.visualSession?.commitPending(true)
  store.visualSession?.dispose()
  editor.value?.destroy()
  store.visualEditor = null
  store.visualSession = null
})
</script>

<template>
  <div class="visual-editor">
    <div class="visual-view-bar">
      <div class="visual-mode" :aria-label="t('visual.mode')">
        <Button size="sm" variant="ghost" :aria-pressed="store.visualEditing" @click="store.visualEditing = true">
          <Pencil :size="15" />{{ t('visual.edit') }}
        </Button>
        <Button size="sm" variant="ghost" :aria-pressed="!store.visualEditing" @click="store.visualSession?.commitPending(true); store.visualEditing = false">
          <Eye :size="15" />{{ t('visual.preview') }}
        </Button>
      </div>
      <span role="status" :class="{ 'visual-error-text': store.visualStatus === 'error' }">{{ t(`visual.${store.visualStatus}`) }}</span>
    </div>
    <div v-if="store.visualStatus === 'error'" class="visual-error" role="alert">
      <span>{{ t('visual.preserveWarning') }} {{ store.visualError }}</span>
      <Button size="sm" variant="outline" @click="rescue">
        <Download :size="16" />{{ t('visual.rescue') }}
      </Button>
    </div>
    <template v-if="editor">
      <VisualToolbar v-if="store.visualEditing" :editor="editor" />
      <EditorContent v-show="store.visualEditing" :editor="editor" />
    </template>
  </div>
</template>
