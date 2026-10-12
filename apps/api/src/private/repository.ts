import type { CommitArticleRequest, CommitArticleResult, HistoryPage, StoredPrivateArticle, VaultState } from '@md/shared/types/private-sync'
import type { PrivateEnv } from './types'
import { articleDigest, articleIdSchema, gitShaSchema, MAX_SYNC_ASSET, MAX_SYNC_JSON, parseCommitRequest, parseStoredArticle, parseVaultState } from '@md/shared/utils/private-sync'
import { readBlob, validateAssetBytes, verifyAssetProofs } from './assets'
import { github, repositoryIdentity } from './github'
import { SyncError } from './types'

interface TreeEntry { path: string, sha: string, type: string, mode: string, size?: number }
interface Snapshot { head: string, treeSha: string, files: Map<string, TreeEntry>, vault: VaultState }

async function snapshot(env: PrivateEnv, at?: string): Promise<Snapshot> {
  const vaultId = await repositoryIdentity(env)
  let head = at
  if (!head) {
    try {
      const ref = await github<{ object: { sha: string } }>(env, `/git/ref/heads/${encodeURIComponent(env.DATA_REPO_BRANCH)}`)
      head = ref.object.sha
    }
    catch (error) {
      if (error instanceof SyncError && [404, 409].includes(error.status))
        throw new SyncError('repository_initialization_required', 409)
      throw error
    }
  }
  gitShaSchema.parse(head)
  const commit = await github<{ tree: { sha: string } }>(env, `/git/commits/${head}`)
  const treeSha = gitShaSchema.parse(commit.tree.sha)
  const tree = await github<{ tree: TreeEntry[], truncated: boolean }>(env, `/git/trees/${treeSha}?recursive=1`)
  if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 100000)
    throw new SyncError('invalid_repository_tree', 422)
  const files = new Map(tree.tree.map(file => [file.path, file]))
  let vault: VaultState = { schemaVersion: 1, vaultId, head, entries: [] }
  const catalog = files.get('catalog.json')
  if (catalog) {
    if (catalog.type !== 'blob' || catalog.mode !== '100644')
      throw new SyncError('invalid_catalog', 422)
    try {
      const raw = JSON.parse(new TextDecoder().decode(await readBlob(env, catalog.sha, MAX_SYNC_JSON)))
      vault = parseVaultState({ ...raw, head })
      if (vault.vaultId !== vaultId)
        throw new Error('vault mismatch')
    }
    catch (error) {
      if (error instanceof SyncError)
        throw error
      throw new SyncError('invalid_catalog', 422)
    }
  }
  else if (tree.tree.some(file => file.path.startsWith('articles/'))) {
    throw new SyncError('missing_catalog', 422)
  }
  return { head, treeSha, files, vault }
}

async function loadArticle(env: PrivateEnv, id: string, source: Snapshot): Promise<StoredPrivateArticle> {
  articleIdSchema.parse(id)
  const entry = source.vault.entries.find(e => e.id === id)
  const metadata = source.files.get(`articles/${id}/meta.json`)
  const body = source.files.get(`articles/${id}/article.md`)
  if (!entry || !metadata || !body)
    throw new SyncError(entry ? 'incomplete_article' : 'article_not_found', entry ? 422 : 404)
  if ([metadata, body].some(f => f.type !== 'blob' || f.mode !== '100644'))
    throw new SyncError('invalid_article_file', 422)
  try {
    const meta = JSON.parse(new TextDecoder().decode(await readBlob(env, metadata.sha, MAX_SYNC_JSON)))
    if (meta.schemaVersion !== 1)
      throw new Error('version')
    const markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await readBlob(env, body.sha, MAX_SYNC_JSON))
    const { schemaVersion: _version, ...storedFields } = meta
    const stored = parseStoredArticle({ ...storedFields, article: { ...meta.article, markdown } })
    if (stored.article.id !== id || stored.revision !== entry.revision || stored.digest !== entry.digest
      || stored.article.title !== entry.title || stored.article.parentId !== entry.parentId || stored.article.deleted !== entry.deleted
      || stored.article.updatedAt !== entry.updatedAt || await articleDigest(stored.article) !== stored.digest) {
      throw new Error('digest')
    }
    for (const asset of stored.article.assets) {
      const file = source.files.get(asset.path)
      if (!asset.blobSha || file?.sha !== asset.blobSha || file.type !== 'blob' || file.mode !== '100644' || file.size !== asset.size)
        throw new Error('asset')
    }
    return stored
  }
  catch (error) {
    if (error instanceof SyncError)
      throw error
    throw new SyncError('article_integrity_failed', 422)
  }
}

export async function readVault(env: PrivateEnv): Promise<VaultState> {
  return (await snapshot(env)).vault
}
export async function readArticle(env: PrivateEnv, id: string, head: string): Promise<StoredPrivateArticle> {
  return loadArticle(env, id, await snapshot(env, gitShaSchema.parse(head)))
}
export async function readAsset(env: PrivateEnv, path: string, head: string): Promise<{ bytes: Uint8Array, mime: string }> {
  if (!/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/.test(path))
    throw new SyncError('invalid_asset_path', 422)
  const source = await snapshot(env, gitShaSchema.parse(head))
  const file = source.files.get(path)
  if (!file || file.type !== 'blob' || file.mode !== '100644')
    throw new SyncError('asset_not_found', 404)
  const bytes = await readBlob(env, file.sha, MAX_SYNC_ASSET)
  const asset = await validateAssetBytes(path, bytes)
  return { bytes, mime: asset.mime }
}

export async function commitArticle(env: PrivateEnv, expectedVaultId: string, value: CommitArticleRequest): Promise<CommitArticleResult> {
  const request = parseCommitRequest(value)
  const { article, operationId, baseRevision } = request
  const digest = await articleDigest(article)
  const vaultId = await repositoryIdentity(env)
  if (vaultId !== expectedVaultId)
    throw new SyncError('vault_changed', 409)
  await verifyAssetProofs(env, vaultId, article.assets)
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await snapshot(env)
    if (source.vault.vaultId !== expectedVaultId)
      throw new SyncError('vault_changed', 409)
    const exists = source.vault.entries.some(e => e.id === article.id)
    if (!exists && (source.files.has(`articles/${article.id}/meta.json`) || source.files.has(`articles/${article.id}/article.md`)))
      throw new SyncError('unindexed_article', 422)
    const current = exists ? await loadArticle(env, article.id, source) : null
    if (current?.operationId === operationId) {
      if (current.digest !== digest)
        throw new SyncError('operation_reused', 409)
      return { head: source.head, stored: current }
    }
    if ((current?.revision ?? null) !== baseRevision)
      throw new SyncError('article_conflict', 409, { head: source.head, stored: current })
    const stored: StoredPrivateArticle = { article, revision: operationId, operationId, digest }
    const entries = source.vault.entries.filter(e => e.id !== article.id)
    entries.push({ id: article.id, title: article.title, parentId: article.parentId, revision: operationId, digest, updatedAt: article.updatedAt, deleted: article.deleted })
    const catalog = parseVaultState({ ...source.vault, entries })
    const { head: _head, ...catalogFile } = catalog
    const { markdown, ...metadataArticle } = article
    const changes = [
      { path: 'catalog.json', mode: '100644', type: 'blob', content: JSON.stringify(catalogFile) },
      { path: `articles/${article.id}/article.md`, mode: '100644', type: 'blob', content: markdown },
      { path: `articles/${article.id}/meta.json`, mode: '100644', type: 'blob', content: JSON.stringify({ schemaVersion: 1, ...stored, article: metadataArticle }) },
      ...article.assets.map(a => ({ path: a.path, mode: '100644', type: 'blob', sha: a.blobSha })),
    ]
    const tree = await github<{ sha: string }>(env, '/git/trees', 'POST', { base_tree: source.treeSha, tree: changes })
    const commit = await github<{ sha: string }>(env, '/git/commits', 'POST', { message: `article: ${operationId}`, tree: gitShaSchema.parse(tree.sha), parents: [source.head] })
    const head = gitShaSchema.parse(commit.sha)
    try {
      await github(env, `/git/refs/heads/${encodeURIComponent(env.DATA_REPO_BRANCH)}`, 'PATCH', { sha: head, force: false })
      return { head, stored }
    }
    catch (error) {
      if (!(error instanceof SyncError) || error.code !== 'repository_changed')
        throw error
    }
  }
  throw new SyncError('repository_busy', 409)
}

export async function listArticleHistory(env: PrivateEnv, id: string, page: number): Promise<HistoryPage> {
  articleIdSchema.parse(id)
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new SyncError('invalid_page', 422)
  await repositoryIdentity(env)
  const params = new URLSearchParams({ sha: env.DATA_REPO_BRANCH, path: `articles/${id}/meta.json`, per_page: '20', page: String(page) })
  const commits = await github<{ sha: string, commit: { committer: { date: string } } }[]>(env, `/commits?${params}`)
  if (!Array.isArray(commits) || commits.length > 20)
    throw new SyncError('invalid_history', 422)
  const entries: HistoryPage['entries'] = []
  for (const commit of commits) {
    const updatedAt = commit.commit?.committer?.date
    if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))
      throw new SyncError('invalid_history', 422)
    entries.push({ head: gitShaSchema.parse(commit.sha), updatedAt })
  }
  return { entries, nextPage: commits.length === 20 ? page + 1 : null }
}
