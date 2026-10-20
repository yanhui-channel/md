import { useFolderSourceStore } from '@/stores/folderSource'
import { usePostStore } from '@/stores/post'

/** Sync editor content changes to the open local folder file (debounced). */
export function useFolderFileSync() {
  const postStore = usePostStore()
  const folderStore = useFolderSourceStore()

  const currentFilePath = ref<string | null>(null)
  let boundFolder: FileSystemDirectoryHandle | null = null
  let boundPostId: string | null = null
  let pendingContent: string | null = null
  let editVersion = 0

  let syncTimeoutId: ReturnType<typeof setTimeout> | null = null

  const SYNC_DELAY = 1000

  function setCurrentFilePath(filePath: string | null) {
    cancelTimer()
    editVersion++
    pendingContent = null
    currentFilePath.value = filePath
    boundFolder = filePath ? folderStore.currentFolderHandle?.handle ?? null : null
    boundPostId = filePath ? postStore.currentPostId : null
  }

  function cancelTimer() {
    if (syncTimeoutId)
      clearTimeout(syncTimeoutId)
    syncTimeoutId = null
  }

  function isBound() {
    return postStore.currentPostId === boundPostId
      && folderStore.currentFolderHandle?.handle === boundFolder
  }

  function connectionPending() {
    return folderStore.isLoading || (!folderStore.currentFolderHandle
      && (folderStore.needsPermission || !!folderStore.loadError))
  }

  async function performSync() {
    if (!currentFilePath.value || pendingContent === null || connectionPending())
      return
    if (!isBound()) {
      setCurrentFilePath(null)
      return
    }
    const filePath = currentFilePath.value
    const content = pendingContent
    const version = editVersion
    const folder = boundFolder
    const postId = boundPostId
    pendingContent = null
    try {
      await folderStore.writeFile(filePath, content)
    }
    catch (error: any) {
      if (editVersion === version && currentFilePath.value === filePath && boundPostId === postId && boundFolder === folder)
        pendingContent ??= content
      console.error('文件同步失败:', error)
    }
  }

  function debouncedSync() {
    cancelTimer()
    if (!currentFilePath.value || pendingContent === null || connectionPending())
      return
    syncTimeoutId = setTimeout(() => {
      syncTimeoutId = null
      void performSync()
    }, SYNC_DELAY)
  }

  watch(
    () => postStore.currentPost?.content,
    (content) => {
      if (!currentFilePath.value || postStore.currentPostId !== boundPostId)
        return
      editVersion++
      pendingContent = content ?? ''
      debouncedSync()
    },
    { deep: false },
  )

  watch(
    () => [connectionPending(), folderStore.currentFolderHandle?.handle, postStore.currentPostId],
    () => {
      if (currentFilePath.value && postStore.currentPostId !== boundPostId)
        setCurrentFilePath(null)
      else if (connectionPending())
        cancelTimer()
      else if (currentFilePath.value && !isBound())
        setCurrentFilePath(null)
      else
        debouncedSync()
    },
    { flush: 'sync' },
  )

  onBeforeUnmount(cancelTimer)

  return {
    currentFilePath,
    setCurrentFilePath,
  }
}
