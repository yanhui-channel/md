import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { t } from '@/i18n/translate'
import { getDatabase } from '@/storage/db'
import { STORE_FOLDERS } from '@/storage/keys'

export interface FileSystemNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileSystemNode[]
  handle?: FileSystemFileHandle | FileSystemDirectoryHandle
}

interface RuntimeFolderInfo {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException)
    return error.message
  return String(error)
}

function getErrorName(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException)
    return error.name
  return `UnknownError`
}

/** Local folder source: File System Access API, file tree, read/write. */
export const useFolderSourceStore = defineStore(`folderSource`, () => {
  const currentRuntimeFolder = shallowRef<RuntimeFolderInfo | null>(null)
  const rememberedHandle = shallowRef<FileSystemDirectoryHandle | null>(null)
  const rememberedFolderName = computed(() => rememberedHandle.value?.name ?? '')
  const needsPermission = ref(false)
  const persistenceError = ref('')
  let restored = false

  // Rebuild the tree from disk; only the directory handle is persisted.
  const fileTree = ref<FileSystemNode[]>([])

  const selectedFilePath = ref<string>(``)

  const isLoading = ref(false)

  const loadError = ref<string>(``)

  /** @deprecated Legacy shape for older callers */
  const currentFolderHandle = computed(() => {
    if (!currentRuntimeFolder.value)
      return null
    return {
      id: currentRuntimeFolder.value.id,
      name: currentRuntimeFolder.value.name,
      handle: currentRuntimeFolder.value.handle,
      permission: true,
    }
  })

  const isFileSystemAPISupported = computed(() => {
    return typeof window !== `undefined` && `showDirectoryPicker` in window
  })

  async function selectFolder() {
    if (isLoading.value)
      return
    if (!isFileSystemAPISupported.value) {
      toast.error(t('store.folder.apiNotSupported'))
      return
    }

    try {
      isLoading.value = true
      restored = true
      loadError.value = ``

      const handle = await window.showDirectoryPicker({
        mode: `readwrite`,
        startIn: `documents`,
      })

      const permission = await handle.requestPermission({ mode: `readwrite` })
      if (permission !== `granted`) {
        throw new Error(t('store.folder.permissionDenied'))
      }

      rememberedHandle.value = handle
      persistenceError.value = ''
      try {
        const db = await getDatabase()
        await db.put(STORE_FOLDERS, { id: 'last', handle })
      }
      catch (error) {
        persistenceError.value = t('folder.rememberFailed', { message: getErrorMessage(error) })
      }
      await activateFolder(handle)

      toast.success(t('store.folder.opened', { name: handle.name }))
    }
    catch (error: unknown) {
      if (getErrorName(error) === `AbortError`) {
        return
      }
      const msg = getErrorMessage(error)
      loadError.value = msg
      toast.error(t('store.folder.openFailed', { message: msg }))
    }
    finally {
      isLoading.value = false
    }
  }

  function closeFolder() {
    currentRuntimeFolder.value = null
    fileTree.value = []
    selectedFilePath.value = ``
  }

  function removeFolder(folderId: string) {
    if (currentRuntimeFolder.value?.id === folderId) {
      closeFolder()
    }
  }

  async function activateFolder(handle: FileSystemDirectoryHandle) {
    closeFolder()
    needsPermission.value = false
    await loadFileTree(handle)
    currentRuntimeFolder.value = { id: generateFolderId(), name: handle.name, handle }
  }

  async function restoreLastFolder() {
    if (restored || isLoading.value || !isFileSystemAPISupported.value)
      return
    restored = true
    isLoading.value = true
    try {
      const db = await getDatabase()
      const saved = await db.get(STORE_FOLDERS, 'last')
      if (!saved)
        return
      rememberedHandle.value = saved.handle
      // Startup may query permission, but only a user action may request it.
      if (await saved.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        needsPermission.value = true
        return
      }
      await activateFolder(saved.handle)
    }
    catch (error) {
      loadError.value = t('folder.restoreFailed', { message: getErrorMessage(error) })
    }
    finally {
      isLoading.value = false
    }
  }

  async function reconnectFolder() {
    if (isLoading.value || !rememberedHandle.value)
      return
    isLoading.value = true
    loadError.value = ''
    closeFolder()
    try {
      const handle = rememberedHandle.value
      if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        needsPermission.value = true
        throw new Error(t('store.folder.permissionDenied'))
      }
      await activateFolder(handle)
    }
    catch (error) {
      loadError.value = t('folder.restoreFailed', { message: getErrorMessage(error) })
    }
    finally {
      isLoading.value = false
    }
  }

  async function forgetFolder() {
    if (isLoading.value)
      return
    isLoading.value = true
    try {
      const db = await getDatabase()
      await db.delete(STORE_FOLDERS, 'last')
      closeFolder()
      rememberedHandle.value = null
      needsPermission.value = false
      loadError.value = ''
      persistenceError.value = ''
      restored = true
    }
    catch (error) {
      persistenceError.value = t('folder.forgetFailed', { message: getErrorMessage(error) })
    }
    finally {
      isLoading.value = false
    }
  }

  async function loadFileTree(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      const tree = await buildFileTree(handle, handle.name)
      fileTree.value = [tree]
    }
    catch (error: unknown) {
      fileTree.value = []
      loadError.value = getErrorMessage(error)
      throw error
    }
  }

  async function buildFileTree(
    handle: FileSystemDirectoryHandle,
    path: string,
  ): Promise<FileSystemNode> {
    const node: FileSystemNode = {
      name: handle.name,
      path,
      type: `directory`,
      children: [],
      handle,
    }

    try {
      for await (const entry of handle.values()) {
        const entryPath = `${path}/${entry.name}`
        if (entry.kind === `file`) {
          if (entry.name.toLowerCase().endsWith(`.md`)) {
            node.children!.push({
              name: entry.name,
              path: entryPath,
              type: `file`,
              handle: entry as FileSystemFileHandle,
            })
          }
        }
        else if (entry.kind === `directory`) {
          const childNode = await buildFileTree(entry as FileSystemDirectoryHandle, entryPath)
          node.children!.push(childNode)
        }
      }

      // Directories first, then files, sorted by name
      node.children!.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === `directory` ? -1 : 1
        }
        return a.name.localeCompare(b.name, `zh-CN`)
      })
    }
    catch (error: unknown) {
      throw new Error(`${path}: ${getErrorMessage(error)}`)
    }

    return node
  }

  async function readFile(filePath: string): Promise<string> {
    if (!currentRuntimeFolder.value) {
      throw new Error(t('store.folder.noFolderSelected'))
    }

    try {
      const node = findNodeByPath(fileTree.value, filePath)
      if (!node) {
        throw new Error(t('store.folder.fileNotFound', { path: filePath }))
      }

      if (node.type !== `file`) {
        throw new Error(t('store.folder.notAFile', { path: filePath }))
      }

      const fileHandle = node.handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      return await file.text()
    }
    catch (error: unknown) {
      toast.error(t('store.folder.readFailed', { message: getErrorMessage(error) }))
      throw error
    }
  }

  async function writeFile(filePath: string, content: string): Promise<void> {
    if (!currentRuntimeFolder.value) {
      throw new Error(t('store.folder.noFolderSelected'))
    }

    try {
      const pathParts = filePath.split(`/`).slice(1) // drop root folder segment
      let currentHandle = currentRuntimeFolder.value.handle as FileSystemDirectoryHandle

      for (let i = 0; i < pathParts.length - 1; i++) {
        const dirName = pathParts[i]
        try {
          currentHandle = await currentHandle.getDirectoryHandle(dirName)
        }
        catch {
          currentHandle = await currentHandle.getDirectoryHandle(dirName, { create: true })
        }
      }

      const fileName = pathParts[pathParts.length - 1]
      const fileHandle = await currentHandle.getFileHandle(fileName, { create: true })

      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
    }
    catch (error: unknown) {
      console.error(`Failed to save file: ${getErrorMessage(error)}`)
      throw error
    }
  }

  function findNodeByPath(nodes: FileSystemNode[], path: string): FileSystemNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node
      }
      if (node.children) {
        const found = findNodeByPath(node.children, path)
        if (found)
          return found
      }
    }
    return null
  }

  function getAllMarkdownFiles(nodes: FileSystemNode[] = fileTree.value): FileSystemNode[] {
    const files: FileSystemNode[] = []
    for (const node of nodes) {
      if (node.type === `file`) {
        files.push(node)
      }
      if (node.children) {
        files.push(...getAllMarkdownFiles(node.children))
      }
    }
    return files
  }

  function generateFolderId(): string {
    return `folder_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  return {
    currentFolderHandle,
    fileTree,
    selectedFilePath,
    isLoading,
    loadError,
    isFileSystemAPISupported,
    rememberedFolderName,
    needsPermission,
    persistenceError,
    restoreLastFolder,
    reconnectFolder,
    forgetFolder,
    selectFolder,
    closeFolder,
    removeFolder,
    loadFileTree,
    readFile,
    writeFile,
    findNodeByPath,
    getAllMarkdownFiles,
  }
})
