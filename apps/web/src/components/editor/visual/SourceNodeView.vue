<script setup lang="ts">
import type { SourcePreviewInput, SourcePreviewState } from '@/lib/visual/source-preview'
import { LanguageDescription } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { Check, Code, Trash2 } from '@lucide/vue'
import { macCodeSvg } from '@md/core/renderer'
import { codeLanguages } from '@md/shared/editor/codeLanguages'
import { lightTheme } from '@md/shared/editor/themes'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { createSourcePreview } from '@/lib/visual/source-preview'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const store = useEditorStore()
const theme = useThemeStore()
const editing = ref(props.node.attrs.kind === 'code' && !props.node.attrs.source && !props.node.attrs.raw)
const host = ref<HTMLElement>()
const state = shallowRef<SourcePreviewState>({ html: '', status: 'loading', error: '' })
const preview = createSourcePreview((value) => { state.value = value })
let view: EditorView | undefined
let mirroring = false
const kind = computed(() => String(props.node.attrs.kind) as SourcePreviewInput['kind'])
const languages = ['plaintext', 'json', 'java', 'sql', 'python', 'javascript', 'typescript', 'yaml', 'bash', 'html', 'css', 'xml', 'markdown']
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', sh: 'bash', shell: 'bash', md: 'markdown', text: 'plaintext', txt: 'plaintext' }
const language = computed(() => {
  const value = String(props.node.attrs.language).trim().split(/\s+/)[0].toLowerCase() || 'plaintext'
  return aliases[value] ?? value
})
const grammar = new Compartment()
async function configureLanguage() {
  const target = view
  const selected = language.value
  if (!target)
    return
  target.dispatch({ effects: grammar.reconfigure([]) })
  const description = kind.value === 'code' && LanguageDescription.matchLanguageName(codeLanguages, selected, false)
  if (!description)
    return
  try {
    const support = await description.load()
    if (view === target && language.value === selected)
      target.dispatch({ effects: grammar.reconfigure(support) })
  }
  catch (error) { console.warn('Code input grammar unavailable; preview remains active', error) }
}
function setLanguage(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const position = props.getPos()
  if (typeof position !== 'number' || !languages.includes(value))
    return
  props.editor.view.dispatch(props.editor.state.tr
    .setNodeMarkup(position, undefined, { ...props.node.attrs, language: value })
    .setMeta('visualHistoryBoundary', true))
}
watch(language, configureLanguage)

watch(() => [props.node.attrs.source, props.node.attrs.language, kind.value], ([source, language]) => {
  preview.update({ source, language, kind: kind.value, themeMode: 'light' })
  if (view && source !== view.state.doc.toString()) {
    mirroring = true
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })
    mirroring = false
  }
}, { immediate: true })

watch(host, (element) => {
  view?.destroy()
  view = undefined
  if (!element)
    return
  view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: props.node.attrs.source,
      extensions: [
        ...lightTheme(),
        grammar.of([]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': t('visual.blockSource'), 'spellcheck': 'false' }),
        keymap.of([
          { key: 'Tab', run(editor) { editor.dispatch(editor.state.replaceSelection('  ')); return true } },
          { key: 'Mod-a', run(editor) { editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } }); return true } },
        ]),
        EditorView.domEventHandlers({ focus() { store.activeTarget = 'visual' } }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || mirroring)
            return
          const position = props.getPos()
          if (typeof position !== 'number')
            return
          const boundary = !update.startState.selection.main.empty
            || update.transactions.some(transaction => !transaction.isUserEvent('input.type'))
          props.editor.view.dispatch(props.editor.state.tr
            .setNodeMarkup(position, undefined, { ...props.node.attrs, source: update.state.doc.toString() })
            .setMeta('visualHistoryBoundary', boundary))
        }),
      ],
    }),
  })
  void configureLanguage()
  view.focus()
}, { flush: 'post' })

onBeforeUnmount(() => { preview.dispose(); view?.destroy(); view = undefined })
</script>

<template>
  <NodeViewWrapper class="visual-source-block" :data-kind="kind" contenteditable="false">
    <div class="visual-source-bar">
      <template v-if="kind === 'code'">
        <span v-if="theme.isMacCodeBlock" class="visual-code-dots" aria-hidden="true" v-html="macCodeSvg" />
        <select class="visual-code-language" :aria-label="t('visual.codeLanguage')" :value="language" @change="setLanguage">
          <option v-if="!languages.includes(language)" :value="language">
            {{ language }}
          </option>
          <option v-for="value in languages" :key="value" :value="value">
            {{ value === 'plaintext' ? t('visual.plainCode') : value }}
          </option>
        </select>
      </template>
      <span v-else>{{ kind === 'mermaid' ? 'Mermaid' : t(`visual.block${kind}`) }}</span>
      <span v-if="state.status === 'loading'" role="status">{{ t('visual.rendering') }}</span>
      <div class="visual-source-actions">
        <button type="button" :title="t(editing ? 'visual.finishSource' : 'visual.editSource')" :aria-label="t(editing ? 'visual.finishSource' : 'visual.editSource')" :aria-expanded="editing" @click="editing = !editing">
          <Check v-if="editing" :size="16" /><Code v-else :size="16" />
        </button>
        <button type="button" :title="t('visual.deleteBlock')" :aria-label="t('visual.deleteBlock')" @click="deleteNode">
          <Trash2 :size="16" />
        </button>
      </div>
    </div>
    <div v-if="editing" ref="host" class="visual-source-input" />
    <div v-if="state.status === 'error'" class="visual-error" role="alert">
      {{ t('visual.invalidSource') }} {{ state.error }}
      <span v-if="state.html">{{ t('visual.stalePreview') }}</span>
    </div>
    <div class="visual-source-preview" :data-md-diagram-state="state.status" :aria-busy="state.status === 'loading'" v-html="state.html" />
  </NodeViewWrapper>
</template>
