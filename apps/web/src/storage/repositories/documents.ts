import type { StoredAsset } from './assets'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import type { Post } from '@/types/post'
import { normalizePostHistory } from '@/lib/format/datetime'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { getDatabase } from '@/storage/db'
import { LEGACY_POSTS_KEY, STORE_ASSETS, STORE_DOCUMENTS, STORE_SETTINGS } from '@/storage/keys'
import { store } from '@/storage/manager'
import { isStorageQuotaError, warnStorageQuota } from '@/storage/quota'
import {
  clearDocumentsPagehideBackup,
  mergeDocumentsWithBackup,
  peekDocumentsPagehideBackup,
} from '@/storage/repositories/documents-backup'
import { fromStored, toStored } from './document-model'

let cachedPosts: Post[] | null = null
let useLegacyStorage = false
let writeQueue: Promise<void> = Promise.resolve()

/** Fallback to localStorage bundle when IndexedDB is unavailable. */
export function setUseLegacyDocumentStorage(enabled: boolean): void {
  useLegacyStorage = enabled
}

export function isUsingLegacyDocumentStorage(): boolean {
  return useLegacyStorage
}

export function getLoadedDocuments(): Post[] | null {
  return cachedPosts
}

export function clearDocumentCache(): void {
  cachedPosts = null
}

function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task)
  writeQueue = next.then(() => {}, () => {})
  return next
}

async function loadFromLegacy(): Promise<Post[]> {
  const raw = await store.get(LEGACY_POSTS_KEY)
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw) as Post[]
    if (!Array.isArray(parsed))
      return []
    return parsed.map((post, index) => ({
      ...post,
      createDatetime: new Date(post.createDatetime ?? Date.now() + index),
      updateDatetime: new Date(post.updateDatetime ?? Date.now() + index),
      history: normalizePostHistory(post.history),
    }))
  }
  catch {
    return []
  }
}

async function saveAllLegacy(posts: Post[]): Promise<void> {
  await store.setJSON(LEGACY_POSTS_KEY, posts)
  cachedPosts = [...posts]
}

async function saveAllIndexedDB(posts: Post[]): Promise<void> {
  if (PRIVATE_SYNC_ENABLED) {
    await (await import('./private-document-writes')).savePrivateDocuments(posts, true)
    cachedPosts = posts.map(p => fromStored(toStored(p)))
    return
  }
  const db = await getDatabase()
  const existing = await db.getAllKeys(STORE_DOCUMENTS)
  const nextIds = new Set(posts.map(p => p.id))
  const tx = db.transaction(STORE_DOCUMENTS, `readwrite`)
  await Promise.all([
    ...posts.map(p => tx.store.put(toStored(p))),
    ...existing.filter(id => !nextIds.has(String(id))).map(id => tx.store.delete(id)),
  ])
  await tx.done
  cachedPosts = [...posts]
}

async function savePostIndexedDB(post: Post): Promise<void> {
  if (PRIVATE_SYNC_ENABLED)
    await (await import('./private-document-writes')).savePrivateDocuments([post], false)
  else await (await getDatabase()).put(STORE_DOCUMENTS, toStored(post))
  if (cachedPosts) {
    const idx = cachedPosts.findIndex(p => p.id === post.id)
    if (idx === -1)
      cachedPosts.push(post)
    else
      cachedPosts[idx] = post
  }
}

async function loadStoredPosts(): Promise<Post[]> {
  if (PRIVATE_SYNC_ENABLED) {
    if (useLegacyStorage)
      throw new Error('private_storage_unavailable')
    return (await import('./private-document-writes')).loadPrivateDocuments()
  }
  if (useLegacyStorage)
    return loadFromLegacy()
  const db = await getDatabase()
  const rows = await db.getAll(STORE_DOCUMENTS)
  return rows.map(fromStored)
}

async function restorePagehideBackup(backup: { token: string | null, posts: Post[] }): Promise<Post[]> {
  if (PRIVATE_SYNC_ENABLED) {
    const existing = await loadStoredPosts()
    const recovered: Post[] = []
    for (const incoming of backup.posts) {
      const current = existing.find(p => p.id === incoming.id)
      if (current?.content === incoming.content && current?.title === incoming.title)
        continue
      const { getLocalDraft } = await import('./private-sync')
      const theme = (await getLocalDraft(incoming.id))?.theme
      const copy = { ...incoming, id: crypto.randomUUID(), title: `${incoming.title} (recovered)`, parentId: null, themeId: undefined }
      await (await import('./private-document-writes')).savePrivateDocuments([copy], false, theme ? { theme, assets: [] } : undefined)
      recovered.push(copy)
    }
    clearDocumentsPagehideBackup(backup.token ?? undefined)
    return [...existing, ...recovered]
  }
  let existing: Post[] = []
  try {
    existing = await loadStoredPosts()
  }
  catch (error) {
    console.error(`[documentRepo] Failed to read posts before restoring backup:`, error)
    cachedPosts = backup.posts
    return backup.posts
  }

  const merged = mergeDocumentsWithBackup(existing, backup.posts)
  try {
    if (useLegacyStorage)
      await saveAllLegacy(merged)
    else
      await saveAllIndexedDB(merged)
    if (backup.token)
      clearDocumentsPagehideBackup(backup.token)
    else
      clearDocumentsPagehideBackup()
  }
  catch (error) {
    console.error(`[documentRepo] Failed to restore pagehide backup:`, error)
    cachedPosts = merged
  }
  return merged
}

export const documentRepo = {
  async importArticle(post: Post, assets: StoredAsset[], theme: ThemeSnapshot): Promise<void> {
    return runSerialized(async () => {
      if (useLegacyStorage || !post.themeId)
        throw new Error('本地数据库不可用，无法恢复完整备份')
      if (PRIVATE_SYNC_ENABLED) {
        if (await (await getDatabase()).get(STORE_DOCUMENTS, post.id))
          throw new Error('article_exists')
        await (await import('./private-document-writes')).savePrivateDocuments([post], false, { assets, theme })
        cachedPosts?.push(post)
        return
      }
      const db = await getDatabase()
      const tx = db.transaction([STORE_DOCUMENTS, STORE_ASSETS, STORE_SETTINGS], 'readwrite')
      void tx.done.catch(() => {})
      try {
        await tx.objectStore(STORE_DOCUMENTS).add(toStored(post))
        await tx.objectStore(STORE_SETTINGS).add({ key: post.themeId, value: JSON.stringify(theme) })
        for (const asset of assets) await tx.objectStore(STORE_ASSETS).put(asset)
        await tx.done
      }
      catch (error) {
        try { tx.abort() }
        catch {}
        await tx.done.catch(() => {})
        throw error
      }
      cachedPosts?.push(post)
    })
  },
  async loadAll(): Promise<Post[]> {
    if (cachedPosts)
      return cachedPosts

    const backup = peekDocumentsPagehideBackup()
    if (backup) {
      cachedPosts = await restorePagehideBackup(backup)
      return cachedPosts
    }

    if (useLegacyStorage) {
      cachedPosts = await loadFromLegacy()
      return cachedPosts
    }

    cachedPosts = await loadStoredPosts()
    return cachedPosts
  },

  async savePost(post: Post): Promise<void> {
    if (PRIVATE_SYNC_ENABLED)
      post = fromStored(JSON.parse(JSON.stringify(toStored(post))))
    return runSerialized(async () => {
      try {
        if (PRIVATE_SYNC_ENABLED && useLegacyStorage)
          throw new Error('private_storage_unavailable')
        if (useLegacyStorage) {
          const all = cachedPosts ?? await this.loadAll()
          const idx = all.findIndex(p => p.id === post.id)
          if (idx === -1)
            all.push(post)
          else
            all[idx] = post
          await saveAllLegacy(all)
          return
        }
        await savePostIndexedDB(post)
      }
      catch (error) {
        if (isStorageQuotaError(error))
          warnStorageQuota()
        console.error(`[documentRepo] savePost failed:`, error)
        throw error
      }
    })
  },

  async saveAll(posts: Post[]): Promise<void> {
    if (PRIVATE_SYNC_ENABLED)
      posts = posts.map(p => fromStored(JSON.parse(JSON.stringify(toStored(p)))))
    return runSerialized(async () => {
      try {
        if (PRIVATE_SYNC_ENABLED && useLegacyStorage)
          throw new Error('private_storage_unavailable')
        if (useLegacyStorage) {
          await saveAllLegacy(posts)
          return
        }
        await saveAllIndexedDB(posts)
      }
      catch (error) {
        if (isStorageQuotaError(error))
          warnStorageQuota()
        console.error(`[documentRepo] saveAll failed:`, error)
        throw error
      }
    })
  },

  async deletePost(id: string): Promise<void> {
    return runSerialized(async () => {
      if (PRIVATE_SYNC_ENABLED) {
        if (useLegacyStorage)
          throw new Error('private_storage_unavailable')
        await saveAllIndexedDB((cachedPosts ?? await this.loadAll()).filter(p => p.id !== id))
        return
      }
      if (useLegacyStorage) {
        const all = (cachedPosts ?? await this.loadAll()).filter(p => p.id !== id)
        await saveAllLegacy(all)
        return
      }
      const db = await getDatabase()
      await db.delete(STORE_DOCUMENTS, id)
      if (cachedPosts)
        cachedPosts = cachedPosts.filter(p => p.id !== id)
    })
  },

  async clear(): Promise<void> {
    return runSerialized(async () => {
      if (PRIVATE_SYNC_ENABLED) {
        if (useLegacyStorage)
          throw new Error('private_storage_unavailable')
        await saveAllIndexedDB([])
        return
      }
      if (useLegacyStorage) {
        await store.remove(LEGACY_POSTS_KEY)
        cachedPosts = []
        return
      }
      const db = await getDatabase()
      await db.clear(STORE_DOCUMENTS)
      cachedPosts = []
    })
  },
}
