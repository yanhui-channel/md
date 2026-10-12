<script setup lang="ts">
import { Cloud, Download, FileCode, FileCog, FileText, FolderKanban, FolderOpen, Package, Rows3, Settings, Share2, Upload } from '@lucide/vue'
import { readArticleBundle, restoreArticleBundle } from '@/services/article-bundle'
import { PNG_SEGMENT_HEIGHTS } from '@/services/export'
import { isShareUiEnabled } from '@/services/share/client'
import { isSyncUiEnabled } from '@/services/sync/client'
import { useEditorStore } from '@/stores/editor'
import { useExportStore } from '@/stores/export'
import { useUIStore } from '@/stores/ui'

const props = withDefaults(defineProps<{
  asSub?: boolean
}>(), {
  asSub: false,
})

const { asSub } = toRefs(props)
const { t } = useI18n()

const editorStore = useEditorStore()
const exportStore = useExportStore()
const uiStore = useUIStore()
const bundleInput = ref<HTMLInputElement>()
const restoring = ref(false)
async function restoreBundle(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || restoring.value)
    return
  restoring.value = true
  try {
    const bundle = await readArticleBundle(file)
    await restoreArticleBundle(bundle)
    toast.success('文章、图片与排版已恢复为新文章')
    if (bundle.external.length || bundle.missing.length)
      toast.warning('此备份含外链或缺失图片，无法完全离线使用')
  }
  catch (error) { toast.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`) }
  finally { restoring.value = false }
}

const { isOpenPostSlider, isOpenFolderPanel } = storeToRefs(uiStore)
const { toggleShowTemplateDialog, toggleShowImportMdDialog, toggleShowSyncDialog, toggleShowEditorStateDialog, toggleShowPreferencesDialog, openShareDialog, openPdfExportDialog } = uiStore
const showSyncUi = isSyncUiEnabled()
const showShareUi = isShareUiEnabled()

function openEditorStateDialog() {
  toggleShowEditorStateDialog(true)
}

function openPreferencesDialog() {
  toggleShowPreferencesDialog(true)
}

function openTemplateDialog() {
  toggleShowTemplateDialog(true)
}

function exportEditorContent2HTML() {
  exportStore.exportEditorContent2HTML()
}

function exportEditorContent2PureHTML() {
  exportStore.exportEditorContent2PureHTML(editorStore.getContent())
}

function exportEditorContent2MD() {
  exportStore.exportEditorContent2MD(editorStore.getContent())
}

function downloadAsCardImage() {
  exportStore.downloadAsCardImage()
}

function downloadAsSegmentedImages(maxSegmentHeight: number) {
  exportStore.downloadAsSegmentedImages(maxSegmentHeight)
}

function exportEditorContent2PDF() {
  openPdfExportDialog()
}
</script>

<template>
  <input ref="bundleInput" data-bundle-input type="file" accept=".zip,application/zip" hidden @change="restoreBundle">
  <MenubarSub v-if="asSub">
    <MenubarSubTrigger>
      {{ t('menu.file') }}
    </MenubarSubTrigger>
    <MenubarSubContent class="min-w-56">
      <MenubarItem @click="isOpenFolderPanel = !isOpenFolderPanel">
        <FolderOpen class="mr-2 size-4" />
        {{ t('menu.localFolder') }}
      </MenubarItem>

      <MenubarSeparator />

      <MenubarSub>
        <MenubarSubTrigger>
          <Upload class="mr-2 size-4" />
          {{ t('menu.import') }}
        </MenubarSubTrigger>
        <MenubarSubContent class="min-w-56">
          <MenubarItem @click="toggleShowImportMdDialog(true)">
            <FileText class="mr-2 size-4" />
            {{ t('menu.importMarkdown') }}
          </MenubarItem>
          <MenubarItem :disabled="restoring" @click="bundleInput?.click()">
            <Package class="mr-2 size-4" />恢复文章备份 ZIP
          </MenubarItem>
        </MenubarSubContent>
      </MenubarSub>

      <MenubarSub>
        <MenubarSubTrigger>
          <Download class="mr-2 size-4" />
          {{ t('menu.export') }}
        </MenubarSubTrigger>
        <MenubarSubContent class="min-w-56">
          <MenubarItem @click="exportEditorContent2MD()">
            <FileText class="mr-2 size-4" />
            {{ t('menu.exportMarkdown') }}
          </MenubarItem>
          <MenubarItem @click="exportStore.exportBundle()">
            <Package class="mr-2 size-4" />文章备份 ZIP
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem @click="exportEditorContent2HTML()">
            <FileCode class="mr-2 size-4" />
            {{ t('menu.exportHtml') }}
          </MenubarItem>
          <MenubarItem @click="exportEditorContent2PureHTML()">
            <FileCode class="mr-2 size-4" />
            {{ t('menu.exportHtmlNoStyle') }}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem @click="exportEditorContent2PDF()">
            <FileText class="mr-2 size-4" />
            {{ t('menu.exportPdf') }}
          </MenubarItem>
          <MenubarItem @click="downloadAsCardImage()">
            <Download class="mr-2 size-4" />
            {{ t('menu.exportPng') }}
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger>
              <Rows3 class="mr-2 size-4" />
              {{ t('menu.exportPngSegments') }}
            </MenubarSubTrigger>
            <MenubarSubContent class="min-w-48">
              <MenubarItem
                v-for="height in PNG_SEGMENT_HEIGHTS"
                :key="height"
                @click="downloadAsSegmentedImages(height)"
              >
                {{ t('menu.exportPngSegmentHeight', { height }) }}
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarSubContent>
      </MenubarSub>

      <MenubarSeparator />

      <MenubarItem @click="openTemplateDialog()">
        <Package class="mr-2 size-4" />
        {{ t('menu.templateManage') }}
      </MenubarItem>

      <MenubarItem @click="isOpenPostSlider = !isOpenPostSlider">
        <FolderKanban class="mr-2 size-4" />
        {{ t('menu.contentManage') }}
      </MenubarItem>

      <template v-if="showSyncUi || showShareUi">
        <MenubarSeparator />
        <MenubarItem v-if="showSyncUi" @click="toggleShowSyncDialog(true)">
          <Cloud class="mr-2 size-4" />
          {{ t('menu.cloudSync') }}
        </MenubarItem>
        <MenubarItem v-if="showShareUi" @click="openShareDialog()">
          <Share2 class="mr-2 size-4" />
          {{ t('menu.sharePreview') }}
        </MenubarItem>
      </template>

      <MenubarSeparator />

      <MenubarItem @click="openPreferencesDialog()">
        <Settings class="mr-2 size-4" />
        {{ t('menu.preferences') }}
      </MenubarItem>

      <MenubarItem @click="openEditorStateDialog()">
        <FileCog class="mr-2 size-4" />
        {{ t('menu.importExportConfig') }}
      </MenubarItem>
    </MenubarSubContent>
  </MenubarSub>

  <MenubarMenu v-else>
    <MenubarTrigger>
      {{ t('menu.file') }}
    </MenubarTrigger>
    <MenubarContent class="min-w-56" align="start">
      <MenubarItem @click="isOpenFolderPanel = !isOpenFolderPanel">
        <FolderOpen class="mr-2 size-4" />
        {{ t('menu.localFolder') }}
      </MenubarItem>

      <MenubarSeparator />

      <MenubarSub>
        <MenubarSubTrigger>
          <Upload class="mr-2 size-4" />
          {{ t('menu.import') }}
        </MenubarSubTrigger>
        <MenubarSubContent class="min-w-56">
          <MenubarItem @click="toggleShowImportMdDialog(true)">
            <FileText class="mr-2 size-4" />
            {{ t('menu.importMarkdown') }}
          </MenubarItem>
          <MenubarItem :disabled="restoring" @click="bundleInput?.click()">
            <Package class="mr-2 size-4" />恢复文章备份 ZIP
          </MenubarItem>
        </MenubarSubContent>
      </MenubarSub>

      <MenubarSub>
        <MenubarSubTrigger>
          <Download class="mr-2 size-4" />
          {{ t('menu.export') }}
        </MenubarSubTrigger>
        <MenubarSubContent class="min-w-56">
          <MenubarItem @click="exportEditorContent2MD()">
            <FileText class="mr-2 size-4" />
            {{ t('menu.exportMarkdown') }}
          </MenubarItem>
          <MenubarItem @click="exportStore.exportBundle()">
            <Package class="mr-2 size-4" />文章备份 ZIP
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem @click="exportEditorContent2HTML()">
            <FileCode class="mr-2 size-4" />
            {{ t('menu.exportHtml') }}
          </MenubarItem>
          <MenubarItem @click="exportEditorContent2PureHTML()">
            <FileCode class="mr-2 size-4" />
            {{ t('menu.exportHtmlNoStyle') }}
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem @click="exportEditorContent2PDF()">
            <FileText class="mr-2 size-4" />
            {{ t('menu.exportPdf') }}
          </MenubarItem>
          <MenubarItem @click="downloadAsCardImage()">
            <Download class="mr-2 size-4" />
            {{ t('menu.exportPng') }}
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger>
              <Rows3 class="mr-2 size-4" />
              {{ t('menu.exportPngSegments') }}
            </MenubarSubTrigger>
            <MenubarSubContent class="min-w-48">
              <MenubarItem
                v-for="height in PNG_SEGMENT_HEIGHTS"
                :key="height"
                @click="downloadAsSegmentedImages(height)"
              >
                {{ t('menu.exportPngSegmentHeight', { height }) }}
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarSubContent>
      </MenubarSub>

      <MenubarSeparator />

      <MenubarItem @click="openTemplateDialog()">
        <Package class="mr-2 size-4" />
        {{ t('menu.templateManage') }}
      </MenubarItem>

      <MenubarItem @click="isOpenPostSlider = !isOpenPostSlider">
        <FolderKanban class="mr-2 size-4" />
        {{ t('menu.contentManage') }}
      </MenubarItem>

      <template v-if="showSyncUi || showShareUi">
        <MenubarSeparator />
        <MenubarItem v-if="showSyncUi" @click="toggleShowSyncDialog(true)">
          <Cloud class="mr-2 size-4" />
          {{ t('menu.cloudSync') }}
        </MenubarItem>
        <MenubarItem v-if="showShareUi" @click="openShareDialog()">
          <Share2 class="mr-2 size-4" />
          {{ t('menu.sharePreview') }}
        </MenubarItem>
      </template>

      <MenubarSeparator />

      <MenubarItem @click="openPreferencesDialog()">
        <Settings class="mr-2 size-4" />
        {{ t('menu.preferences') }}
      </MenubarItem>

      <MenubarItem @click="openEditorStateDialog()">
        <FileCog class="mr-2 size-4" />
        {{ t('menu.importExportConfig') }}
      </MenubarItem>
    </MenubarContent>
  </MenubarMenu>
</template>
