<script setup lang="ts">
import type SearchTabType from '@/components/ui/search-tab/SearchTab.vue'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { history, markdownSetup, replaceDocumentWithoutHistory, resetEditorHistory, theme } from '@md/shared/editor'
import { createComponentCompletionExtension } from '@/composables/useComponentCompletion'
import { useEditorRefresh } from '@/composables/useEditorRefresh'
import { completeInitialPreviewBoot } from '@/composables/useInitialPreviewBoot'
import { useLocalizedAllComponents } from '@/composables/useLocalizedBuiltinComponents'
import { useSlashCommand } from '@/composables/useSlashCommand'
import { CONTENT_FONT_LANG } from '@/i18n/constants'
import { toStoredDateTime } from '@/lib/format/datetime'
import { jumpToAdjacentHeading } from '@/lib/markdown/headingNavigation'
import { contentHasMath, loadMathJax, MATHJAX_READY_EVENT } from '@/lib/preview/mathjax'
import { collectClipboardImages } from '@/lib/upload/clipboard-images'
import { collectImageReferences, rewriteImageReferences } from '@/lib/visual/assets'
import { assetRepo } from '@/storage/repositories/assets'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useRenderStore } from '@/stores/render'
import { useThemeStore } from '@/stores/theme'
import { useUIStore } from '@/stores/ui'

const SidebarAIToolbar = defineAsyncComponent(() => import('@/components/ai/SidebarAIToolbar.vue'))
const SlashCommandMenu = defineAsyncComponent(() => import('@/components/editor/SlashCommandMenu.vue'))
const SearchTab = defineAsyncComponent(() => import('@/components/ui/search-tab/SearchTab.vue'))

const { t, locale } = useI18n()
const editorStore = useEditorStore()
const postStore = usePostStore()
const renderStore = useRenderStore()
const themeStore = useThemeStore()
const uiStore = useUIStore()
const localizedAllComponents = useLocalizedAllComponents()
const { editorRefresh, scheduleEditorRefresh } = useEditorRefresh()

const {
  visible: slashVisible,
  position: slashPosition,
  filter: slashFilter,
  activeIndex: slashActiveIndex,
  basicCommands: slashBasicCommands,
  commonCommands: slashCommonCommands,
  editCommands: slashEditCommands,
  styleCommands: slashStyleCommands,
  filteredCommands: slashFilteredCommands,
  closeMenu: closeSlashMenu,
  executeCommand: executeSlashCommand,
  createExtension: createSlashExtension,
} = useSlashCommand()

function onWrapperContextMenuCapture(e: MouseEvent) {
  if (!slashVisible.value)
    return
  e.preventDefault()
  e.stopPropagation()
}

const { editor } = storeToRefs(editorStore)
const { isDark, showAIToolbox } = storeToRefs(uiStore)
const { posts, currentPostIndex, currentPost } = storeToRefs(postStore)
const {
  isMobile,
  viewMode,
} = storeToRefs(uiStore)

const { toggleShowUploadImgDialog } = uiStore

const showEditor = computed(() => viewMode.value !== `preview`)

const codeMirrorView = shallowRef<EditorView | null>(null)
const themeCompartment = new Compartment()
const placeholderCompartment = new Compartment()
const historyCompartment = new Compartment()

function editorPlaceholder() {
  return placeholder(t(`codemirror.contentPlaceholder`))
}
const persistTimer = ref<ReturnType<typeof setTimeout>>()

const editorRef = useTemplateRef<HTMLDivElement>(`editorRef`)
const codeMirrorWrapper = useTemplateRef<HTMLDivElement>(`codeMirrorWrapper`)

const isImgLoading = ref(false)

// Editor refresh is provided by useEditorRefresh()

// --- Search tab integration ---
const searchTabRef = useTemplateRef<InstanceType<typeof SearchTabType>>(`searchTabRef`)
const searchTabMounted = ref(false)
const pendingSearchRequest = ref<{ selected: string } | null>(null)

function applySearchRequest(
  target: InstanceType<typeof SearchTabType>,
  word: string,
  showReplace = false,
) {
  if (showReplace)
    target.setSearchWithReplace(word)
  else if (word)
    target.setSearchWord(word)
  else
    target.showSearchTab = true
}

function mountSearchTab() {
  searchTabMounted.value = true
}

const { searchTabRequest } = storeToRefs(uiStore)

function openSearchWithSelection(view: EditorView) {
  mountSearchTab()
  const selection = view.state.selection.main
  const selected = view.state.doc.sliceString(selection.from, selection.to).trim()

  if (searchTabRef.value)
    applySearchRequest(searchTabRef.value, selected)
  else
    pendingSearchRequest.value = { selected }
}

function openReplaceWithSelection(view: EditorView) {
  mountSearchTab()
  const selection = view.state.selection.main
  const selected = view.state.doc.sliceString(selection.from, selection.to).trim()

  if (searchTabRef.value)
    searchTabRef.value.setSearchWithReplace(selected)
  else
    uiStore.openSearchTab(selected, true)
}

watch(searchTabRef, (newRef) => {
  if (!newRef)
    return

  if (pendingSearchRequest.value) {
    applySearchRequest(newRef, pendingSearchRequest.value.selected)
    pendingSearchRequest.value = null
  }

  if (searchTabRequest.value) {
    const { word, showReplace } = searchTabRequest.value
    applySearchRequest(newRef, word, showReplace)
    uiStore.clearSearchTabRequest()
  }
})

watch(searchTabRequest, (request) => {
  if (!request)
    return
  mountSearchTab()
  if (searchTabRef.value) {
    applySearchRequest(searchTabRef.value, request.word, request.showReplace)
    uiStore.clearSearchTabRequest()
  }
})

function handleGlobalKeydown(e: KeyboardEvent) {
  const editorView = codeMirrorView.value
  if (e.key === `Escape` && searchTabRef.value?.showSearchTab) {
    searchTabRef.value.showSearchTab = false
    e.preventDefault()
    editorView?.focus()
  }
}

// --- Local images and Markdown files ---
async function uploadImage(file: File, cb?: (url: string, data: string) => void, applyUrl?: boolean) {
  isImgLoading.value = true
  try {
    const paths = !cb || applyUrl ? await editorStore.addImages([file]) : [(await assetRepo.put(file)).path]
    cb?.(paths[0] ?? '', '')
    toggleShowUploadImgDialog(false)
    toast.success(t('visual.imageSaved'))
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.error(message.startsWith('visual.') || message.startsWith('upload.') ? t(message) : message)
    cb?.('', '')
  }
  finally { isImgLoading.value = false }
}

async function importLocalFiles(list: { path: string, file: File }[]) {
  editorStore.visualSession?.commitPending(true)
  for (const md of list.filter(item => /\.(?:md|markdown|txt)$/i.test(item.path))) {
    const original = await md.file.text()
    const replacements: Record<string, string> = {}
    const folder = md.path.slice(0, md.path.lastIndexOf('/') + 1)
    for (const path of collectImageReferences(original)) {
      if (/^(?:https?:|data:|blob:)/i.test(path))
        continue
      const candidate = list.find(item => item.path === folder + path.replace(/^\.\//, ''))
      if (candidate)
        replacements[path] = (await assetRepo.put(candidate.file)).path
    }
    postStore.addPost(md.file.name.replace(/\.(md|markdown|txt)$/i, ''))
    postStore.updatePostContent(postStore.currentPostId, rewriteImageReferences(original, replacements))
  }
}

async function readDirectory(handle: any, parent = ''): Promise<{ path: string, file: File }[]> {
  if (handle.kind === 'file')
    return [{ path: parent + handle.name, file: await handle.getFile() }]
  const files: { path: string, file: File }[] = []
  for await (const child of handle.values())
    files.push(...await readDirectory(child, `${parent + handle.name}/`))
  return files
}

function setupLocalFileDrop() {
  const dom = codeMirrorWrapper.value
  if (!dom)
    return
  dom.ondragover = event => event.preventDefault()
  dom.ondrop = (event) => {
    event.preventDefault()
    editorStore.activeTarget = 'source'
    const files = collectClipboardImages(event.dataTransfer)
    const selectedFiles = Array.from(event.dataTransfer?.files ?? [])
    if (files.length && !selectedFiles.some(file => /\.(?:md|markdown|txt)$/i.test(file.name))) {
      void editorStore.addImages(files).catch(error => toast.error(t(error.message)))
      return
    }
    const items = Array.from(event.dataTransfer?.items ?? [])
    void (async () => {
      const list: { path: string, file: File }[] = []
      for (const item of items) {
        const directoryItem = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<any> }
        const handle = await directoryItem.getAsFileSystemHandle?.()
        if (handle)
          list.push(...await readDirectory(handle))
      }
      await importLocalFiles(list.length ? list : selectedFiles.map(file => ({ path: file.name, file })))
    })().catch(error => toast.error(t(error.message)))
  }
}

function createPasteHandler() {
  return (event: ClipboardEvent) => {
    const files = collectClipboardImages(event.clipboardData)
    if (!files.length)
      return false
    event.preventDefault()
    editorStore.activeTarget = 'source'
    void editorStore.addImages(files).catch(error => toast.error(t(error.message)))
    return true
  }
}

// --- CodeMirror creation ---
function createFormTextArea(dom: HTMLDivElement) {
  const state = EditorState.create({
    doc: posts.value[currentPostIndex.value].content,
    extensions: [
      markdownSetup({
        onSearch: openSearchWithSelection,
        onReplace: openReplaceWithSelection,
        onGoToLine: () => uiStore.requestGoToLine(),
        withoutHistory: true,
      }),
      historyCompartment.of(history()),
      Prec.high(keymap.of([
        { key: `Mod-Alt-ArrowUp`, run: view => jumpToAdjacentHeading(view, `prev`) },
        { key: `Mod-Alt-ArrowDown`, run: view => jumpToAdjacentHeading(view, `next`) },
      ])),
      placeholderCompartment.of(editorPlaceholder()),
      themeCompartment.of(theme(isDark.value)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          scheduleEditorRefresh()
          clearTimeout(persistTimer.value)
          persistTimer.value = setTimeout(() => {
            commitEditorContentToPost()
          }, 300)
        }
      }),
      EditorView.domEventHandlers({
        paste: createPasteHandler(),
        drop: event => (event.dataTransfer?.files.length ?? 0) > 0,
        focus: () => { editorStore.activeTarget = 'source' },
      }),
      ...createSlashExtension(() => codeMirrorView.value),
      ...createComponentCompletionExtension(() => localizedAllComponents.value),
    ],
  })

  const view = new EditorView({
    state,
    parent: dom,
  })

  codeMirrorView.value = view
  return view
}

// --- Lifecycle ---
function handleMathJaxReady() {
  editorRefresh()
}

async function preloadMathJaxIfNeeded(content: string) {
  if (!contentHasMath(content))
    return

  try {
    await loadMathJax()
  }
  catch (error) {
    console.error(error)
  }
}

let postSwitchGeneration = 0

function flushEditorContentToPost(postId: string) {
  clearTimeout(persistTimer.value)
  persistTimer.value = undefined
  if (!codeMirrorView.value || !postId)
    return

  const value = codeMirrorView.value.state.doc.toString()
  const post = postStore.getPostById(postId)
  if (!post || value === post.content)
    return

  post.updateDatetime = new Date()
  post.content = value
}

function commitEditorContentToPost() {
  flushEditorContentToPost(editorStore.sourcePostId)
}

onMounted(() => {
  const editorDom = editorRef.value
  if (editorDom == null) {
    void completeInitialPreviewBoot()
    return
  }

  window.addEventListener(MATHJAX_READY_EVENT, handleMathJaxReady)
  document.addEventListener(`keydown`, handleGlobalKeydown, { passive: false, capture: false })

  void (async () => {
    try {
      await renderStore.initRendererInstance({
        isMacCodeBlock: themeStore.isMacCodeBlock,
        isShowLineNumber: themeStore.isShowLineNumber,
      })
      themeStore.applyCurrentTheme()
      await nextTick()

      const editorView = createFormTextArea(editorDom)
      editor.value = editorView
      editorStore.sourcePostId = postStore.currentPostId
      editorStore.registerContentFlush(commitEditorContentToPost)

      const content = posts.value[currentPostIndex.value]?.content ?? ``
      await preloadMathJaxIfNeeded(content)

      editorRefresh()
      setupLocalFileDrop()
    }
    catch (error) {
      console.error(`[EditorPanel] Failed to initialize editor`, error)
    }
    finally {
      void completeInitialPreviewBoot()
    }
  })()
})

watch(isDark, () => {
  if (codeMirrorView.value) {
    codeMirrorView.value.dispatch({
      effects: themeCompartment.reconfigure(theme(isDark.value)),
    })
  }
  editorRefresh()
})

watch(locale, () => {
  if (!codeMirrorView.value)
    return
  codeMirrorView.value.dispatch({
    effects: placeholderCompartment.reconfigure(editorPlaceholder()),
  })
  editorRefresh()
})

function syncEditorToPostContent(content: string, switched = false) {
  const view = codeMirrorView.value
  if (!view)
    return

  const currentContent = view.state.doc.toString()
  if (currentContent === content && !switched)
    return

  const generation = ++postSwitchGeneration
  if (currentContent !== content)
    replaceDocumentWithoutHistory(view, content)
  resetEditorHistory(view, historyCompartment)
  void preloadMathJaxIfNeeded(content).then(() => {
    if (generation !== postSwitchGeneration)
      return
    editorRefresh()
  })
}

watch(() => postStore.currentPostId, (newId, oldId) => {
  try { editorStore.detachVisualSession() }
  catch (error) {
    console.error(error)
    if (oldId && postStore.getPostById(oldId))
      postStore.currentPostId = oldId
    return
  }
  if (oldId)
    flushEditorContentToPost(oldId)

  const post = postStore.getPostById(newId)
  if (!post)
    return
  syncEditorToPostContent(post.content, true)
  editorStore.sourcePostId = post.id
})

/** Refresh editor when posts change externally (e.g. cloud sync) even if index is unchanged */
watch(
  () => currentPost.value?.content,
  (content) => {
    // Article identity must switch before its content reaches the old session.
    if (content == null || editorStore.sourcePostId !== postStore.currentPostId)
      return
    syncEditorToPostContent(content)
  },
)

const historyTimer = ref<ReturnType<typeof setTimeout>>()
onMounted(() => {
  historyTimer.value = setInterval(() => {
    const currentPost = posts.value[currentPostIndex.value]

    const pre = (currentPost.history || [])[0]?.content
    if (pre === currentPost.content) {
      return
    }

    currentPost.history ??= []
    currentPost.history.unshift({
      content: currentPost.content,
      datetime: toStoredDateTime(),
    })

    currentPost.history.length = Math.min(currentPost.history.length, 10)
  }, 30 * 1000)
})

onUnmounted(() => {
  editorStore.unregisterContentFlush()
  window.removeEventListener(MATHJAX_READY_EVENT, handleMathJaxReady)
  clearTimeout(historyTimer.value)
  clearTimeout(persistTimer.value)
  document.removeEventListener(`keydown`, handleGlobalKeydown, { capture: false })
})

defineExpose({
  codeMirrorView,
  editorRefresh,
  uploadImage,
  isImgLoading,
})
</script>

<template>
  <div
    v-show="viewMode !== 'preview'"
    ref="codeMirrorWrapper"
    class="codeMirror-wrapper relative h-full"
    @contextmenu.capture="onWrapperContextMenuCapture"
  >
    <SearchTab
      v-if="searchTabMounted && codeMirrorView"
      ref="searchTabRef"
      :editor-view="codeMirrorView as any"
    />
    <SlashCommandMenu
      v-if="slashVisible"
      :visible="slashVisible"
      :position="slashPosition"
      :active-index="slashActiveIndex"
      :filter="slashFilter"
      :container-el="codeMirrorWrapper"
      :basic-commands="slashBasicCommands"
      :common-commands="slashCommonCommands"
      :edit-commands="slashEditCommands"
      :style-commands="slashStyleCommands"
      :filtered-commands="slashFilteredCommands"
      @execute="(cmd) => codeMirrorView && executeSlashCommand(codeMirrorView, cmd)"
      @close="closeSlashMenu()"
    />
    <SidebarAIToolbar
      v-if="showAIToolbox"
      :is-mobile="isMobile"
      :show-editor="showEditor"
    />

    <EditorContextMenu>
      <div
        id="editor"
        ref="editorRef"
        class="codemirror-container mathjax-ignore"
        :lang="CONTENT_FONT_LANG"
      />
    </EditorContextMenu>
  </div>
</template>

<style lang="less" scoped>
@import url('../../assets/less/app.less');
</style>

<style lang="less" scoped>
.codeMirror-wrapper {
  overflow-x: hidden;
  height: 100%;
  position: relative;
}
</style>
