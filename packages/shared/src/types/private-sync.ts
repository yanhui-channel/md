import type { ThemeSnapshot } from '../utils/article-theme'

export interface PrivateAsset { path: string, sha256: string, mime: string, size: number, blobSha: string | null, proof?: string }
export interface PrivateArticle {
  id: string
  title: string
  parentId: string | null
  markdown: string
  theme: ThemeSnapshot
  assets: PrivateAsset[]
  external: string[]
  createdAt: string
  updatedAt: string
  deleted: boolean
}
export interface StoredPrivateArticle { article: PrivateArticle, revision: string, digest: string, operationId: string }
export interface CommitArticleRequest { baseRevision: string | null, operationId: string, article: PrivateArticle }
export interface CommitArticleResult { head: string, stored: StoredPrivateArticle }
export interface CatalogEntry { id: string, title: string, parentId: string | null, revision: string, digest: string, updatedAt: string, deleted: boolean }
export interface VaultState { schemaVersion: 1, vaultId: string, head: string | null, entries: CatalogEntry[] }
export interface HistoryPage { entries: { head: string, updatedAt: string }[], nextPage: number | null }
