import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import type { StoredAsset } from '@/storage/repositories/assets'
import type { Post } from '@/types/post'
import { uuidv4 } from '@md/shared/utils/uuid'
import { getDefaultContent } from '@/assets/example/default-content'
import { t } from '@/i18n/translate'
import { debounce } from '@/lib/debounce'
import { normalizePostHistory, toStoredDateTime } from '@/lib/format/datetime'
import { postSignature } from '@/lib/post-signature'
import { captureThemeSnapshot } from '@/lib/visual/capture-theme'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { documentRepo, getLoadedDocuments, store } from '@/storage'
import { addPrefix } from '@/storage/prefix'
import { clearDocumentsPagehideBackup, writeDocumentsPagehideBackup } from '@/storage/repositories/documents-backup'
import { useCssEditorStore } from '@/stores/cssEditor'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'

export type { Post } from '@/types/post'

function createDefaultPost(): Post {
  const content = getDefaultContent()
  return {
    id: uuidv4(),
    title: t('store.post.defaultTitle'),
    content,
    history: [
      { datetime: toStoredDateTime(), content },
    ],
    createDatetime: new Date(),
    updateDatetime: new Date(),
  }
}

function normalizePosts(raw: Post[]): Post[] {
  return raw.map((post, index) => {
    const now = Date.now()
    return {
      ...post,
      id: post.id ?? uuidv4(),
      createDatetime: new Date(post.createDatetime ?? now + index),
      updateDatetime: new Date(post.updateDatetime ?? now + index),
      history: normalizePostHistory(post.history),
    }
  })
}

/** Post list, current post, and CRUD operations. */
export const usePostStore = defineStore(`post`, () => {
  const loaded = getLoadedDocuments()
  const posts = ref<Post[]>(
    loaded?.length ? normalizePosts(loaded) : [createDefaultPost()],
  )

  const currentPostId = store.reactive(addPrefix(`current_post_id`), ``)
  const sortMode = store.reactive(addPrefix(`sort_mode`), `create-old-new`)

  let persistReady = false
  let restoring = false
  const pendingThemes = new Map<string, Promise<ThemeSnapshot>>()
  const getPendingTheme = (id: string) => pendingThemes.get(id)

  function reportSaveFailure(error: unknown) {
    writeDocumentsPagehideBackup([...posts.value])
    const editor = useEditorStore()
    editor.visualStatus = 'error'
    editor.visualError = error instanceof Error ? error.message : String(error)
  }

  const persistAll = debounce(async (snapshot: Post[]) => {
    await documentRepo.saveAll(snapshot).catch(reportSaveFailure)
  }, 500)

  /**
   * Ids of posts changed since the last flush. A single debounced savePost
   * would drop an earlier post when two different posts change within one
   * debounce window (the shared timer keeps only the latest argument), so
   * ids are collected first and every changed post is flushed.
   */
  const dirtyPostIds = new Set<string>()

  const persistDirty = debounce(async () => {
    const ids = [...dirtyPostIds]
    dirtyPostIds.clear()
    if (ids.length === 0)
      return
    if (ids.length === 1) {
      const post = posts.value.find(p => p.id === ids[0])
      // The post may have been deleted while the debounce was pending.
      if (post)
        await documentRepo.savePost(post).catch(reportSaveFailure)
      return
    }
    await documentRepo.saveAll([...posts.value]).catch(reportSaveFailure)
  }, 500)

  /** Flush immediately on delete etc. so a refresh before debounce finishes does not restore stale data. */
  async function persistImmediately(): Promise<void> {
    if (restoring)
      return
    persistAll.cancel()
    persistDirty.cancel()
    dirtyPostIds.clear()
    const snapshot = posts.value.map(post => ({ ...post, history: post.history.map(entry => ({ ...entry })) }))
    // IndexedDB writes may not finish before a tab is killed (OAuth redirect).
    const backupToken = writeDocumentsPagehideBackup(snapshot)
    await documentRepo.saveAll(snapshot)
    clearDocumentsPagehideBackup(backupToken)
  }

  async function restoreArticle(post: Post, assets: StoredAsset[], theme: ThemeSnapshot): Promise<void> {
    if (restoring)
      throw new Error('正在恢复文章，请稍候')
    restoring = true
    persistReady = false
    persistAll.cancel()
    persistDirty.cancel()
    try {
      useEditorStore().flushContentToPostStore()
      await documentRepo.saveAll([...posts.value])
      await documentRepo.importArticle(post, assets, theme)
      await store.get(post.themeId!)
      posts.value.push(post)
      currentPostId.value = post.id
      await nextTick()
    }
    finally {
      restoring = false
      persistReady = true
    }
  }

  // Watching per-post signatures instead of a deep watch on `posts`: the
  // signature read is shallow (no traversal into history entry bodies), so
  // each editor content commit no longer deep-traverses every post. A
  // signature change at index i implies posts.value[i] changed.
  watch(
    () => posts.value.map(postSignature),
    (signatures, oldSignatures) => {
      if (!persistReady)
        return

      if (!oldSignatures || signatures.length !== oldSignatures.length) {
        persistAll([...posts.value])
        return
      }

      let changed = false
      for (let i = 0; i < signatures.length; i++) {
        if (signatures[i] !== oldSignatures[i]) {
          dirtyPostIds.add(posts.value[i].id)
          changed = true
        }
      }
      if (changed)
        persistDirty()
    },
  )

  onBeforeMount(() => {
    posts.value = normalizePosts(posts.value)

    if (!currentPostId.value || !posts.value.some(p => p.id === currentPostId.value))
      currentPostId.value = posts.value[0]?.id ?? ``

    if (!loaded?.length)
      void documentRepo.saveAll(posts.value).catch(reportSaveFailure)

    persistReady = true
  })

  onMounted(() => {
    const editorStore = useEditorStore()
    if (PRIVATE_SYNC_ENABLED) {
      const theme = useThemeStore()
      const css = useCssEditorStore()
      watch(() => JSON.stringify({
        id: currentPostId.value,
        restored: theme.restoredTheme,
        settings: theme.themeSettings[theme.theme],
        theme: theme.theme,
        css: css.getCurrentTabContent(),
        width: theme.previewWidth,
        legend: theme.legend,
        cite: theme.isCiteStatus,
        count: theme.isCountStatus,
        indent: theme.isUseIndent,
        justify: theme.isUseJustify,
      }), (_next, previous) => {
        if (!restoring && currentPostId.value && JSON.parse(previous).id === currentPostId.value) {
          const captured = captureThemeSnapshot()
          pendingThemes.set(currentPostId.value, captured)
          void captured.catch(reportSaveFailure)
          dirtyPostIds.add(currentPostId.value)
          persistDirty()
        }
      }, { flush: 'sync' })
    }

    const flushToDisk = () => {
      editorStore.flushContentToPostStore()
      persistAll.flush()
      persistDirty.flush()
      void persistImmediately().catch(reportSaveFailure)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === `hidden`)
        flushToDisk()
    }

    window.addEventListener(`pagehide`, flushToDisk)
    window.addEventListener(`beforeunload`, flushToDisk)
    document.addEventListener(`visibilitychange`, onVisibilityChange)
    onUnmounted(() => {
      window.removeEventListener(`pagehide`, flushToDisk)
      window.removeEventListener(`beforeunload`, flushToDisk)
      document.removeEventListener(`visibilitychange`, onVisibilityChange)
    })
  })

  function replacePosts(nextPosts: Post[]) {
    persistAll.cancel()
    persistDirty.cancel()
    dirtyPostIds.clear()
    posts.value = normalizePosts(nextPosts)
    void documentRepo.saveAll(posts.value).catch(reportSaveFailure)
  }

  async function replacePostsAndPersist(nextPosts: Post[]): Promise<void> {
    persistAll.cancel()
    persistDirty.cancel()
    dirtyPostIds.clear()
    posts.value = normalizePosts(nextPosts)
    await documentRepo.saveAll(posts.value)
  }

  async function acceptPrivatePosts(nextPosts: Post[]): Promise<void> {
    persistReady = false
    restoring = true
    persistAll.cancel()
    persistDirty.cancel()
    dirtyPostIds.clear()
    pendingThemes.clear()
    try {
      posts.value = normalizePosts(nextPosts)
      if (!posts.value.some(p => p.id === currentPostId.value))
        currentPostId.value = posts.value[0]?.id ?? ''
      await nextTick()
    }
    finally { persistReady = true; restoring = false }
  }

  const findIndexById = (id: string) => posts.value.findIndex(p => p.id === id)

  const currentPostIndex = computed<number>({
    get: () => findIndexById(currentPostId.value),
    set: (idx) => {
      if (idx >= 0 && idx < posts.value.length)
        currentPostId.value = posts.value[idx].id
    },
  })

  const getPostById = (id: string) => posts.value.find(p => p.id === id)
  const currentPost = computed(() => getPostById(currentPostId.value))

  const addPost = (title: string, parentId: string | null = null) => {
    const newPost: Post = {
      id: uuidv4(),
      title,
      content: `# ${title}`,
      history: [
        { datetime: toStoredDateTime(), content: `# ${title}` },
      ],
      createDatetime: new Date(),
      updateDatetime: new Date(),
      parentId,
    }
    posts.value.push(newPost)
    currentPostId.value = newPost.id
  }

  const renamePost = (id: string, title: string) => {
    const post = getPostById(id)
    if (post) {
      post.title = title
      post.updateDatetime = new Date()
    }
  }

  const delPost = (id: string, recursive: boolean = false) => {
    const post = getPostById(id)
    if (!post)
      return

    if (recursive) {
      const getChildIds = (parentId: string): string[] => {
        const children = posts.value.filter(p => p.parentId === parentId)
        return children.reduce((acc, child) => {
          return acc.concat(child.id, getChildIds(child.id))
        }, [] as string[])
      }

      const allIdsToDelete = [id, ...getChildIds(id)]
      allIdsToDelete.forEach((toDelId) => {
        const idx = findIndexById(toDelId)
        if (idx !== -1)
          posts.value.splice(idx, 1)
      })

      if (!posts.value.some(p => p.id === currentPostId.value))
        currentPostId.value = posts.value[Math.max(0, posts.value.length - 1)]?.id ?? ``

      void persistImmediately().catch(reportSaveFailure)
      return
    }

    const newParentId = post.parentId ?? null
    posts.value.forEach((p) => {
      if (p.parentId === id) {
        p.parentId = newParentId
        p.updateDatetime = new Date()
      }
    })

    const idx = findIndexById(id)
    if (idx === -1)
      return

    posts.value.splice(idx, 1)
    currentPostId.value = posts.value[Math.min(idx, posts.value.length - 1)]?.id ?? ``
    void persistImmediately().catch(reportSaveFailure)
  }

  const updatePostParentId = (postId: string, parentId: string | null) => {
    const post = getPostById(postId)
    if (post) {
      post.parentId = parentId
      post.updateDatetime = new Date()
    }
  }

  const updatePostContent = (id: string, content: string) => {
    const post = getPostById(id)
    if (post) {
      post.content = content
      post.updateDatetime = new Date()
    }
  }

  const collapseAllPosts = () => {
    posts.value.forEach((post) => {
      post.collapsed = true
    })
  }

  const expandAllPosts = () => {
    posts.value.forEach((post) => {
      post.collapsed = false
    })
  }

  return {
    posts,
    currentPostId,
    sortMode,
    currentPostIndex,
    currentPost,
    getPostById,
    findIndexById,
    addPost,
    renamePost,
    delPost,
    updatePostParentId,
    updatePostContent,
    collapseAllPosts,
    expandAllPosts,
    replacePosts,
    replacePostsAndPersist,
    acceptPrivatePosts,
    persistImmediately,
    restoreArticle,
    getPendingTheme,
  }
})
