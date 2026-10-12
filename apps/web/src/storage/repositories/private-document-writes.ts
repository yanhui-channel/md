import type { StoredAsset } from './assets'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import type { Post } from '@/types/post'
import { captureStoredArticleTheme } from '@/lib/visual/capture-theme'
import { getDatabase } from '@/storage/db'
import { fromStored, toStored } from './document-model'
import { getSyncRecord, saveLocalArticle } from './private-sync'

// Each tab remembers what it actually read; a later global save cannot erase unseen work.
const observed = new Map<string, { generation: number, post: Post, serialized: string, theme: string }>()
export async function loadPrivateDocuments(): Promise<Post[]> {
  const tx = (await getDatabase()).transaction(['documents', 'meta'], 'readonly')
  const rows = await tx.objectStore('documents').getAll()
  const next = new Map<string, { generation: number, post: Post, serialized: string, theme: string }>()
  for (const row of rows) {
    const raw = await tx.objectStore('meta').get(`private:local:${row.id}`)
    const draft = raw ? JSON.parse(raw.value) : null
    const post = fromStored(row)
    next.set(row.id, { generation: draft?.generation ?? 0, post, serialized: JSON.stringify(toStored(post)), theme: JSON.stringify(draft?.theme ?? null) })
  }
  await tx.done
  observed.clear()
  for (const [id, entry] of next) observed.set(id, entry)
  return rows.map(fromStored)
}

export async function savePrivateDocuments(posts: Post[], replace: boolean, imported?: { assets: StoredAsset[], theme: ThemeSnapshot }): Promise<void> {
  const active = await (await getDatabase()).get('meta', 'private:active-vault')
  const vault = active?.value ?? 'local'
  const ids = new Set(posts.map(p => p.id))
  for (const post of posts) {
    const old = observed.get(post.id)
    const serialized = JSON.stringify(toStored(post))
    let theme: ThemeSnapshot | null = imported?.theme ?? null
    if (!theme) {
      try { theme = await captureStoredArticleTheme(post.id) }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'theme_capture_required')
          throw error
        if ((await getSyncRecord(vault, post.id)).selected)
          throw error
      }
    }
    const themeJson = JSON.stringify(theme)
    if (old?.serialized === serialized && old.theme === themeJson)
      continue
    const generation = await saveLocalArticle(post, theme, vault, old?.generation ?? 0, false, imported?.assets)
    observed.set(post.id, { generation, post: fromStored(toStored(post)), serialized, theme: themeJson })
    window.dispatchEvent(new CustomEvent('md:private-saved', { detail: { id: post.id, generation } }))
  }
  if (replace) {
    for (const [id, old] of observed) {
      if (ids.has(id))
        continue
      const generation = await saveLocalArticle(old.post, JSON.parse(old.theme), vault, old.generation, true)
      observed.delete(id)
      window.dispatchEvent(new CustomEvent('md:private-saved', { detail: { id, generation } }))
    }
  }
}
