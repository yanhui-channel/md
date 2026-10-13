<script setup lang="ts">
import { Cloud, Copy, Loader2, Menu, Palette } from '@lucide/vue'
import { defineAsyncComponent } from 'vue'
import { delay } from '@/lib/delay'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { processClipboardContent } from '@/services/export'
import { buildPublicationHtml, purePublicationHtml } from '@/services/export/html'
import { preparePublication } from '@/services/export/publication'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { usePrivateSyncStore } from '@/stores/privateSync'
import { useUIStore } from '@/stores/ui'
import EditDropdown from './EditDropdown.vue'
import FileDropdown from './FileDropdown.vue'
import FormatDropdown from './FormatDropdown.vue'
import HelpDropdown from './HelpDropdown.vue'
import InsertDropdown from './InsertDropdown.vue'
import StyleDropdown from './StyleDropdown.vue'

const emit = defineEmits([`startCopy`, `endCopy`])
const { t } = useI18n()
const AboutDialog = defineAsyncComponent(() => import('./AboutDialog.vue'))
const FundDialog = defineAsyncComponent(() => import('./FundDialog.vue'))
const EditorStateDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/EditorStateDialog.vue'))
const PreferencesDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/PreferencesDialog.vue'))
const MarkdownHelpDialog = defineAsyncComponent(() => import('./MarkdownHelpDialog.vue'))
const KeyboardShortcutsDialog = defineAsyncComponent(() => import('./KeyboardShortcutsDialog.vue'))
const AccountDialog = defineAsyncComponent(() => import('./AccountDialog.vue'))
const SyncDialog = defineAsyncComponent(() => import('./SyncDialog.vue'))
const PrivateSyncPanel = defineAsyncComponent(() => import('./PrivateSyncPanel.vue'))
const privateSync = PRIVATE_SYNC_ENABLED ? usePrivateSyncStore() : null
const ShareDialog = defineAsyncComponent(() => import('./ShareDialog.vue'))
const PdfExportDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/PdfExportDialog.vue'))

const editorStore = useEditorStore()
const uiStore = useUIStore()
const { isOpenRightSlider, isShowSyncDialog, isShowAccountDialog, isShowShareDialog, isShowPdfExportDialog, isShowAboutDialog, isShowFundDialog, isShowEditorStateDialog, isShowPreferencesDialog, isShowMarkdownHelpDialog, isShowKeyboardShortcutsDialog, copyMode } = storeToRefs(uiStore)

const isCopying = ref(false)

const { copy: copyContent } = useClipboard({
  legacy: true,
})

const normalizeErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function writeClipboardItems(items: ClipboardItem[]) {
  if (!navigator.clipboard?.write) {
    throw new Error(`Clipboard API not available.`)
  }

  await delay(0)
  await navigator.clipboard.write(items)
}

function fallbackCopyUsingExecCommand(htmlContent: string) {
  const selection = window.getSelection()

  if (!selection) {
    return false
  }

  const tempContainer = document.createElement(`div`)
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
  tempContainer.innerHTML = htmlContent
  tempContainer.style.position = `fixed`
  tempContainer.style.left = `-9999px`
  tempContainer.style.top = `0`
  tempContainer.style.opacity = `0`
  tempContainer.style.pointerEvents = `none`
  tempContainer.style.setProperty(`background-color`, `#ffffff`, `important`)
  tempContainer.style.setProperty(`color`, `#000000`, `important`)

  document.body.appendChild(tempContainer)
  let successful = false

  try {
    const range = document.createRange()
    range.selectNodeContents(tempContainer)
    selection.removeAllRanges()
    selection.addRange(range)

    successful = document.execCommand(`copy`)
  }
  catch {
    successful = false
  }
  finally {
    selection.removeAllRanges()
    tempContainer.remove()
    ranges.forEach(range => selection.addRange(range))
  }

  return successful
}

async function copy() {
  isCopying.value = true
  const mode = copyMode.value
  let publication: Awaited<ReturnType<typeof preparePublication>> | undefined
  try {
    if (mode === 'md') {
      const post = usePostStore().currentPost
      if (!post)
        return
      const snapshot = editorStore.captureMarkdown(post)
      await copyContent(snapshot.markdown)
      toast.success(t('toast.copiedMarkdown'))
      return
    }
    publication = await preparePublication('light')
    emit('startCopy')
    const result = await processClipboardContent(publication.theme.settings.primaryColor, publication)
    if (mode === 'txt') {
      try {
        await writeClipboardItems([new ClipboardItem({
          'text/html': new Blob([result.html], { type: 'text/html' }),
          'text/plain': new Blob([result.plainText], { type: 'text/plain' }),
        })])
      }
      catch (error) {
        if (!fallbackCopyUsingExecCommand(result.html))
          throw error
      }
    }
    else if (mode === 'html-without-style') {
      await copyContent(await purePublicationHtml(publication))
    }
    else if (mode === 'html-and-style') {
      await copyContent(buildPublicationHtml(publication))
    }
    else {
      await copyContent(result.html)
    }
    toast.success(t(mode === 'html' ? 'toast.copiedHtml' : 'toast.copiedRendered'))
    if (result.hasLocalImages)
      toast.warning(t('visual.wechatLocalImages'))
    window.dispatchEvent(new CustomEvent('copyToMp', { detail: { content: result.html } }))
  }
  catch (error) { toast.error(t('toast.copyFailed', { message: normalizeErrorMessage(error) })) }
  finally {
    publication?.dispose()
    emit('endCopy')
    isCopying.value = false
  }
}

function handleCopy(mode: string) {
  copyMode.value = mode
  copy()
}

function copyToWeChat() {
  copyMode.value = 'txt'
  copy()
}
</script>

<template>
  <header
    class="header-container h-15 flex flex-wrap items-center justify-between px-5 relative"
  >
    <div class="space-x-1 hidden md:flex">
      <Menubar class="menubar border-0">
        <FileDropdown />
        <EditDropdown @copy="handleCopy" />
        <FormatDropdown />
        <InsertDropdown />
        <StyleDropdown />
        <HelpDropdown />
      </Menubar>
    </div>

    <div class="md:hidden">
      <Menubar class="menubar border-0 p-0">
        <MenubarMenu>
          <MenubarTrigger class="p-0" :aria-label="t('header.menu')">
            <Button variant="outline" size="icon" tabindex="-1" aria-hidden="true">
              <Menu class="size-4" />
            </Button>
          </MenubarTrigger>
          <MenubarContent align="start">
            <FileDropdown :as-sub="true" />
            <EditDropdown :as-sub="true" @copy="handleCopy" />
            <FormatDropdown :as-sub="true" />
            <InsertDropdown :as-sub="true" />
            <StyleDropdown :as-sub="true" />
            <HelpDropdown :as-sub="true" />
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="privateSync" variant="outline" class="h-9 max-md:w-9 max-md:px-0" :title="t('privateSync.title')" :aria-label="t('privateSync.title')" @click="isShowSyncDialog = true">
        <Cloud class="size-4 md:mr-2" />
        <span class="max-md:hidden" role="status">{{ t(`privateSync.${privateSync.status}`) }}</span>
      </Button>
      <Button
        variant="outline"
        class="h-9 max-md:w-9 max-md:px-0"
        :disabled="isCopying"
        :aria-busy="isCopying"
        :aria-label="t('header.copy')"
        @click="copyToWeChat"
      >
        <Loader2 v-if="isCopying" class="h-4 w-4 animate-spin md:mr-2" />
        <Copy v-else class="h-4 w-4 md:hidden" />
        <span class="max-md:hidden">{{ t('header.copy') }}</span>
      </Button>

      <PostInfo class="hidden md:inline-flex" />

      <Button
        variant="outline"
        class="h-9 max-md:w-9 max-md:px-0"
        :class="{ 'bg-accent text-accent-foreground': isOpenRightSlider }"
        :aria-label="t('header.style')"
        @click="isOpenRightSlider = !isOpenRightSlider"
      >
        <Palette class="h-4 w-4 md:hidden" />
        <span class="max-md:hidden">{{ t('header.style') }}</span>
      </Button>
    </div>
  </header>

  <AboutDialog v-if="isShowAboutDialog" v-model:open="isShowAboutDialog" />
  <FundDialog v-if="isShowFundDialog" v-model:open="isShowFundDialog" />
  <EditorStateDialog v-if="isShowEditorStateDialog" v-model:open="isShowEditorStateDialog" />
  <PreferencesDialog v-model:open="isShowPreferencesDialog" />
  <MarkdownHelpDialog v-if="isShowMarkdownHelpDialog" v-model:open="isShowMarkdownHelpDialog" />
  <KeyboardShortcutsDialog v-if="isShowKeyboardShortcutsDialog" v-model:open="isShowKeyboardShortcutsDialog" />
  <AccountDialog v-if="isShowAccountDialog && !PRIVATE_SYNC_ENABLED" v-model:open="isShowAccountDialog" />
  <SyncDialog v-if="isShowSyncDialog && !PRIVATE_SYNC_ENABLED" v-model:open="isShowSyncDialog" />
  <PrivateSyncPanel v-if="isShowSyncDialog && PRIVATE_SYNC_ENABLED" v-model:open="isShowSyncDialog" />
  <ShareDialog v-if="isShowShareDialog" v-model:open="isShowShareDialog" />
  <PdfExportDialog v-if="isShowPdfExportDialog" v-model:open="isShowPdfExportDialog" />
</template>

<style lang="less" scoped>
.header-container {
  background: hsl(var(--background) / 0.95);
  border-bottom: 1px solid hsl(var(--border));
  backdrop-filter: blur(12px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50;

  @media (max-width: 768px) {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}

.menubar {
  user-select: none;

  :deep([data-radix-menubar-trigger]) {
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.5rem 0.875rem;
    border-radius: 6px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;

    &:hover {
      background: hsl(var(--accent) / 0.8);
      color: hsl(var(--accent-foreground));
      transform: translateY(-1px);
    }

    &[data-state='open'] {
      background: hsl(var(--accent));
      color: hsl(var(--accent-foreground));
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);
    }

    &:active {
      transform: translateY(0);
    }
  }

  :deep([data-radix-menubar-content]) {
    animation: slideDownAndFade 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  :deep([data-radix-menubar-item]) {
    border-radius: 4px;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);

    &:hover {
      background: hsl(var(--accent) / 0.8);
    }
  }

  :deep([data-radix-menubar-sub-trigger]) {
    border-radius: 4px;
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);

    &:hover {
      background: hsl(var(--accent) / 0.8);
    }
  }
}

kbd {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 1.5rem;
  height: 1.375rem;
  border: 1px solid hsl(var(--border));
  background: linear-gradient(to bottom, hsl(var(--muted)), hsl(var(--muted) / 0.9));
  padding: 0 0.375rem;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  box-shadow: 0 1px 0 hsl(var(--border)), inset 0 0.5px 0 hsl(var(--background));
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

@keyframes slideDownAndFade {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .menubar {
    flex-direction: column;
    align-items: flex-start;
    width: 100%;

    > * {
      width: 100%;
      justify-content: flex-start;
    }
  }
}
</style>
