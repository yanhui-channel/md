import type { CommitArticleRequest, CommitArticleResult, PrivateArticle, StoredPrivateArticle } from '@md/shared/types/private-sync'
import type { StoredAsset } from './assets'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import type { MdDatabase, StoredDocument } from '@/storage/db'
import type { Post } from '@/types/post'
import { articleDigest, parsePrivateArticle, parseStoredArticle } from '@md/shared/utils/private-sync'
import { collectImageReferences } from '@/lib/visual/assets'
import { validateThemeSnapshot } from '@/lib/visual/theme-snapshot'
import { getDatabase } from '@/storage/db'
import { LOCAL_ASSET_PATTERN, validateAsset } from './assets'
import { fromStored, toStored } from './document-model'

export interface PreparedSyncOperation { request: CommitArticleRequest, generation: number }
export interface LocalDraft { generation: number, post: StoredDocument, theme: ThemeSnapshot | null, deleted: boolean }
export interface PrivateSyncRecord {
  selected: boolean
  localGeneration: number
  confirmedGeneration: number
  baseRevision: string | null
  confirmedDigest: string | null
  pending: PreparedSyncOperation | null
  conflict: { head: string, stored: StoredPrivateArticle | null } | null
}
const localKey = (id: string) => `private:local:${id}`
const syncKey = (vault: string, id: string) => `private:sync:${vault}:${id}`
const blank = (): PrivateSyncRecord => ({ selected: false, localGeneration: 0, confirmedGeneration: 0, baseRevision: null, confirmedDigest: null, pending: null, conflict: null })
const parse = <T>(row: { value: string } | undefined, fallback: T): T => row ? JSON.parse(row.value) : fallback
function openWrite(db: MdDatabase) { return db.transaction(['documents', 'assets', 'settings', 'meta'], 'readwrite') }
type WriteTx = ReturnType<typeof openWrite>
async function write<T>(action: (tx: WriteTx) => Promise<T>): Promise<T> {
  const tx = openWrite(await getDatabase())
  try {
    const result = await action(tx)
    await tx.done
    return result
  }
  catch (error) {
    try { tx.abort() }
    catch {}
    await tx.done.catch(() => {})
    throw error
  }
}
function putMeta(tx: WriteTx, key: string, value: unknown) { return tx.objectStore('meta').put({ key, value: JSON.stringify(value) }) }
export async function getLocalDraft(id: string): Promise<LocalDraft | null> {
  return parse(await (await getDatabase()).get('meta', localKey(id)), null)
}
export async function getSyncRecord(vault: string, id: string): Promise<PrivateSyncRecord> {
  return parse(await (await getDatabase()).get('meta', syncKey(vault, id)), blank())
}
export async function listSyncRecords(vault: string): Promise<{ id: string, record: PrivateSyncRecord }[]> {
  const prefix = `private:sync:${vault}:`
  return (await (await getDatabase()).getAll('meta')).filter(row => row.key.startsWith(prefix)).map(row => ({ id: row.key.slice(prefix.length), record: JSON.parse(row.value) }))
}

export async function selectArticle(vault: string, id: string, selected: boolean): Promise<void> {
  await write(async (tx) => {
    const local = parse<LocalDraft | null>(await tx.objectStore('meta').get(localKey(id)), null)
    if (!local?.theme)
      throw new Error('theme_capture_required')
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, id)), blank())
    await putMeta(tx, syncKey(vault, id), { ...record, selected, localGeneration: local.generation })
  })
}

export async function saveLocalArticle(post: Post, theme: ThemeSnapshot | null, vault: string, expectedGeneration: number, deleted = false, assets: StoredAsset[] = []): Promise<number> {
  const stored = toStored(post)
  const checkedTheme = theme ? validateThemeSnapshot(theme) : null
  return write(async (tx) => {
    const current = parse<LocalDraft | null>(await tx.objectStore('meta').get(localKey(post.id)), null)
    if ((current?.generation ?? 0) !== expectedGeneration)
      throw new Error('local_conflict')
    const generation = expectedGeneration + 1
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, post.id)), blank())
    if (deleted)
      await tx.objectStore('documents').delete(post.id)
    else await tx.objectStore('documents').put(stored)
    if (checkedTheme)
      await tx.objectStore('settings').put({ key: `private:theme:${post.id}`, value: JSON.stringify(checkedTheme) })
    if (checkedTheme && stored.themeId)
      await tx.objectStore('settings').put({ key: stored.themeId, value: JSON.stringify(checkedTheme) })
    for (const asset of assets) await tx.objectStore('assets').put(asset)
    await putMeta(tx, localKey(post.id), { generation, post: stored, theme: checkedTheme, deleted } satisfies LocalDraft)
    await putMeta(tx, syncKey(vault, post.id), { ...record, localGeneration: generation })
    return generation
  })
}

async function articleFromDraft(draft: LocalDraft): Promise<PrivateArticle> {
  if (!draft.theme)
    throw new Error('theme_capture_required')
  const db = await getDatabase()
  const assets: PrivateArticle['assets'] = []
  const external: string[] = []
  for (const path of collectImageReferences(draft.post.content)) {
    if (LOCAL_ASSET_PATTERN.test(path)) {
      const asset = await db.get('assets', path)
      if (!asset)
        throw new Error('missing_asset')
      assets.push({ path: asset.path, sha256: asset.sha256, mime: asset.mime, size: asset.size, blobSha: null })
    }
    else if (/^(?:https?:\/\/|\/\/)/i.test(path)) {
      external.push(path.startsWith('//') ? `https:${path}` : path)
    }
    else if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(path)) {
      throw new Error('missing_asset')
    }
  }
  const post = draft.post
  return parsePrivateArticle({ id: post.id, title: post.title, parentId: post.parentId ?? null, markdown: post.content, theme: draft.theme, assets, external, createdAt: post.createDatetime, updatedAt: post.updateDatetime, deleted: draft.deleted })
}
export async function preparePending(vault: string, id: string): Promise<PreparedSyncOperation | null> {
  const record = await getSyncRecord(vault, id)
  if (!record.selected || record.conflict)
    return null
  if (record.pending)
    return record.pending
  const draft = await getLocalDraft(id)
  if (!draft || draft.generation === record.confirmedGeneration)
    return null
  const article = await articleFromDraft(draft)
  const digest = await articleDigest(article)
  return write(async (tx) => {
    const current = parse<LocalDraft | null>(await tx.objectStore('meta').get(localKey(id)), null)
    const latest = parse(await tx.objectStore('meta').get(syncKey(vault, id)), blank())
    if (current?.generation !== draft.generation || !latest.selected || latest.conflict)
      return null
    if (latest.pending)
      return latest.pending
    if (digest === latest.confirmedDigest) {
      await putMeta(tx, syncKey(vault, id), { ...latest, confirmedGeneration: draft.generation })
      return null
    }
    const pending = { request: { article, baseRevision: latest.baseRevision, operationId: crypto.randomUUID() }, generation: draft.generation }
    await putMeta(tx, syncKey(vault, id), { ...latest, localGeneration: draft.generation, pending })
    return pending
  })
}
export async function confirmPending(vault: string, id: string, generation: number, result: CommitArticleResult): Promise<void> {
  const stored = parseStoredArticle(result.stored)
  if (stored.article.id !== id || stored.revision !== stored.operationId || await articleDigest(stored.article) !== stored.digest)
    throw new Error('invalid_confirmation')
  const previous = await getSyncRecord(vault, id)
  if (!previous.pending || previous.pending.generation !== generation || previous.pending.request.operationId !== stored.operationId
    || await articleDigest(previous.pending.request.article) !== stored.digest) {
    throw new Error('invalid_confirmation')
  }
  await write(async (tx) => {
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, id)), blank())
    if (record.pending?.request.operationId !== stored.operationId)
      throw new Error('local_conflict')
    await putMeta(tx, syncKey(vault, id), { ...record, pending: null, baseRevision: stored.revision, confirmedDigest: stored.digest, confirmedGeneration: generation })
  })
}

export async function rememberConflict(vault: string, id: string, conflict: PrivateSyncRecord['conflict']): Promise<void> {
  await write(async (tx) => {
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, id)), blank())
    await putMeta(tx, syncKey(vault, id), { ...record, conflict })
  })
}

export async function applyRemote(vault: string, value: StoredPrivateArticle, assets: StoredAsset[], expectedGeneration: number, preserveLocal = false): Promise<string | undefined> {
  const stored = parseStoredArticle(value)
  const article = stored.article
  const theme = validateThemeSnapshot(article.theme)
  if (await articleDigest(article) !== stored.digest || stored.revision !== stored.operationId)
    throw new Error('article_integrity_failed')
  if (assets.length !== article.assets.length)
    throw new Error('missing_asset')
  for (const meta of article.assets) {
    const file = assets.find(a => a.path === meta.path)
    if (!file)
      throw new Error('missing_asset')
    const checked = await validateAsset(new File([file.blob], meta.path, { type: meta.mime }))
    if (checked.path !== meta.path || checked.size !== meta.size || checked.mime !== meta.mime)
      throw new Error('invalid_asset')
  }
  const themeId = `private:theme:${article.id}:${stored.revision}`
  const post: StoredDocument = { id: article.id, title: article.title, content: article.markdown, parentId: article.parentId, createDatetime: article.createdAt, updateDatetime: article.updatedAt, themeId, history: [] }
  return write(async (tx) => {
    let copyId: string | undefined
    const local = parse<LocalDraft | null>(await tx.objectStore('meta').get(localKey(article.id)), null)
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, article.id)), blank())
    if (!local && await tx.objectStore('documents').get(article.id))
      throw new Error('theme_capture_required')
    if ((local?.generation ?? 0) !== expectedGeneration || (!preserveLocal && (record.pending || record.conflict
      || (local && local.generation !== record.confirmedGeneration)))) {
      throw new Error('local_conflict')
    }
    if (preserveLocal && local) {
      const id = crypto.randomUUID()
      copyId = id
      const copy = { ...local.post, id, parentId: null, title: `${local.post.title} (local copy)`, themeId: `private:theme:${id}` }
      await tx.objectStore('documents').add(copy)
      if (local.theme)
        await tx.objectStore('settings').put({ key: copy.themeId, value: JSON.stringify(local.theme) })
      await putMeta(tx, localKey(id), { generation: 1, post: copy, theme: local.theme, deleted: false })
    }
    const generation = expectedGeneration + 1
    if (article.deleted)
      await tx.objectStore('documents').delete(article.id)
    else await tx.objectStore('documents').put(post)
    await tx.objectStore('settings').put({ key: themeId, value: JSON.stringify(theme) })
    for (const asset of assets) await tx.objectStore('assets').put(asset)
    await putMeta(tx, localKey(article.id), { generation, post, theme, deleted: article.deleted })
    await putMeta(tx, syncKey(vault, article.id), { ...blank(), selected: true, localGeneration: generation, confirmedGeneration: generation, baseRevision: stored.revision, confirmedDigest: stored.digest })
    return copyId
  })
}

export async function localPost(id: string): Promise<Post | null> {
  const draft = await getLocalDraft(id)
  return draft ? fromStored(draft.post) : null
}

export async function rebaseLocal(vault: string, id: string, remote: StoredPrivateArticle | null, expectedGeneration: number) {
  await write(async (tx) => {
    const local = parse<LocalDraft | null>(await tx.objectStore('meta').get(localKey(id)), null)
    if (local?.generation !== expectedGeneration)
      throw new Error('local_conflict')
    const record = parse(await tx.objectStore('meta').get(syncKey(vault, id)), blank())
    await putMeta(tx, syncKey(vault, id), { ...record, baseRevision: remote?.revision ?? null, confirmedDigest: remote?.digest ?? null, confirmedGeneration: 0, pending: null, conflict: null })
  })
}
