<script setup lang="ts">
import {
  FolderClosed,
  FolderOpen,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  Loader2,
  RefreshCw,
  X,
} from '@lucide/vue'
import { useFolderFileSync } from '@/composables/useFolderFileSync'
import { useFolderSourceStore } from '@/stores/folderSource'
import { usePostStore } from '@/stores/post'
import { useUIStore } from '@/stores/ui'
import FolderTree from './FolderTree.vue'

const { t } = useI18n()
const folderSourceStore = useFolderSourceStore()
const postStore = usePostStore()
const uiStore = useUIStore()
const { setCurrentFilePath } = useFolderFileSync()

const { isMobile, isOpenFolderPanel } = storeToRefs(uiStore)

const enableAnimation = ref(false)

watch(isOpenFolderPanel, () => {
  if (isMobile.value) {
    enableAnimation.value = true
  }
})

watch(isMobile, () => {
  enableAnimation.value = false
})

const {
  currentFolderHandle,
  fileTree,
  selectedFilePath,
  isLoading,
  loadError,
  isFileSystemAPISupported,
  rememberedFolderName,
  needsPermission,
  persistenceError,
} = storeToRefs(folderSourceStore)

const expandedPaths = ref<Set<string>>(new Set())

onMounted(() => folderSourceStore.restoreLastFolder())
watch(() => fileTree.value[0]?.path, (path) => {
  if (path)
    expandedPaths.value.add(path)
}, { immediate: true })

function handleToggleExpand(path: string) {
  if (expandedPaths.value.has(path)) {
    expandedPaths.value.delete(path)
  }
  else {
    expandedPaths.value.add(path)
  }

  expandedPaths.value = new Set(expandedPaths.value)
}

async function handleSelectFolder() {
  await folderSourceStore.selectFolder()
  await nextTick()

  if (fileTree.value.length > 0) {
    expandedPaths.value.add(fileTree.value[0].path)
  }
}

async function handleRefreshFolder() {
  await folderSourceStore.reconnectFolder()
}

async function handleForgetFolder() {
  await folderSourceStore.forgetFolder()
  if (!rememberedFolderName.value)
    expandedPaths.value.clear()
}

async function handleOpenFile(node: any) {
  try {
    const content = await folderSourceStore.readFile(node.path)
    const title = node.name.replace(/\.md$/i, ``)

    postStore.addPost(title)
    postStore.updatePostContent(postStore.currentPostId, content)

    setCurrentFilePath(node.path)

    toast.success(t('folder.fileLoaded', { name: node.name }))
  }
  catch (error) {
    console.error(t('folder.openFileFailed'), error)
  }
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="isMobile && isOpenFolderPanel"
      class="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
      @click="isOpenFolderPanel = false"
    />
  </Transition>

  <div
    class="folder-source-panel h-full flex flex-col"
    :class="{
      'fixed top-0 left-0 z-55 w-full bg-background border-r border-border shadow-xl': isMobile,
      'animate-slider': isMobile && enableAnimation,
    }"
    :style="isMobile ? { transform: isOpenFolderPanel ? 'translateX(0)' : 'translateX(-100%)' } : undefined"
  >
    <div class="panel-header sticky top-0 z-10 bg-background border-b p-2">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <FolderTreeIcon class="h-4 w-4" />
          {{ t('folder.title') }}
        </h3>
        <div class="flex items-center gap-1">
          <Button
            v-if="rememberedFolderName"
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :title="t('folder.forgetFolder')"
            :aria-label="t('folder.forgetFolder')"
            :disabled="isLoading"
            @click="handleForgetFolder"
          >
            <FolderClosed class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :title="t('folder.closePanel')"
            :aria-label="t('folder.closePanel')"
            @click="isOpenFolderPanel = false"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div class="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          class="flex-1 text-xs"
          :disabled="isLoading || !isFileSystemAPISupported"
          @click="handleSelectFolder"
        >
          <FolderPlus v-if="!isLoading" class="h-3 w-3 mr-1" />
          <Loader2 v-else class="h-3 w-3 mr-1 animate-spin" />
          {{ t('folder.openFolder') }}
        </Button>

        <Button
          v-if="currentFolderHandle"
          variant="outline"
          size="sm"
          class="text-xs"
          :disabled="isLoading"
          :aria-label="t('common.refresh')"
          :title="t('common.refresh')"
          :aria-busy="isLoading"
          @click="handleRefreshFolder"
        >
          <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': isLoading }" />
        </Button>
      </div>
    </div>

    <div class="panel-content flex-1 overflow-y-auto p-2">
      <p v-if="persistenceError" role="alert" class="text-xs text-destructive mb-3 break-words">
        {{ persistenceError }}
      </p>
      <div
        v-if="!isFileSystemAPISupported"
        class="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground"
      >
        <FolderClosed class="h-12 w-12 mb-2 opacity-50" />
        <p class="text-sm">
          {{ t('folder.browserUnsupported') }}
        </p>
        <p class="text-xs mt-1">
          {{ t('folder.browserHint') }}
        </p>
      </div>

      <div
        v-else-if="isLoading"
        class="flex flex-col items-center justify-center h-full"
      >
        <Loader2 class="h-8 w-8 animate-spin text-primary" />
        <p class="text-sm text-muted-foreground mt-2">
          {{ t('common.loading') }}
        </p>
      </div>

      <div
        v-else-if="loadError || (rememberedFolderName && !currentFolderHandle)"
        class="flex flex-col items-center justify-center h-full text-center p-4 gap-3"
      >
        <FolderClosed class="h-10 w-10 text-muted-foreground" />
        <p v-if="rememberedFolderName" class="text-sm font-medium break-all">
          {{ rememberedFolderName }}
        </p>
        <p v-if="loadError" role="alert" class="text-sm text-destructive break-words">
          {{ loadError }}
        </p>
        <p v-else-if="needsPermission" class="text-sm text-muted-foreground">
          {{ t('folder.permissionRequired') }}
        </p>
        <Button v-if="rememberedFolderName" variant="outline" size="sm" @click="folderSourceStore.reconnectFolder()">
          <RefreshCw class="h-3 w-3 mr-1" />
          {{ t('folder.reconnect') }}
        </Button>
      </div>

      <div
        v-else-if="!currentFolderHandle"
        class="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground"
      >
        <FolderOpen class="h-12 w-12 mb-2 opacity-50" />
        <p class="text-sm">
          {{ t('folder.noFolder') }}
        </p>
        <p class="text-xs mt-1">
          {{ t('folder.noFolderHint') }}
        </p>
      </div>

      <div v-else class="file-tree-container">
        <div class="text-xs text-muted-foreground mb-2 px-2">
          {{ currentFolderHandle.name }}
        </div>
        <FolderTree
          :nodes="fileTree"
          :selected-path="selectedFilePath"
          :expanded-paths="expandedPaths"
          @select="handleOpenFile"
          @toggle-expand="handleToggleExpand"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-source-panel {
  background-color: hsl(var(--background));
}

.panel-header {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.panel-content {
  min-height: 0;
}

.file-tree-container {
  min-height: 100%;
}

.animate-slider {
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
