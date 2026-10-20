import type { CommitArticleRequest, PrivateArticle, StoredPrivateArticle, VaultState } from '../types/private-sync'
import { z } from 'zod'
import { assertNoCssResources, themeSchema } from './article-theme'

export const MAX_SYNC_JSON = 30 * 1024 * 1024
export const MAX_SYNC_ASSET = 10 * 1024 * 1024
export const MAX_SYNC_EXPANDED = 100 * 1024 * 1024
export const articleIdSchema = z.string().regex(/^[\w-]{1,120}$/)
export const gitShaSchema = z.string().regex(/^[a-f0-9]{40}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const date = z.iso.datetime()
export const privateAssetSchema = z.object({
  path: z.string().regex(/^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/),
  sha256: digest,
  mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  size: z.number().int().positive().max(MAX_SYNC_ASSET),
  blobSha: gitShaSchema.nullable(),
  proof: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(asset => asset.path === `assets/${asset.sha256}.${asset.mime === 'image/jpeg' ? 'jpg' : asset.mime.slice(6)}`)
const articleSchema = z.object({
  id: articleIdSchema,
  title: z.string().max(1000),
  parentId: articleIdSchema.nullable(),
  markdown: z.string().max(MAX_SYNC_JSON),
  theme: themeSchema,
  assets: z.array(privateAssetSchema).max(497),
  external: z.array(z.url().refine(url => /^https?:\/\//i.test(url))).max(5000),
  createdAt: date,
  updatedAt: date,
  deleted: z.boolean(),
}).strict().refine(a => a.parentId !== a.id && new Set(a.assets.map(v => v.path)).size === a.assets.length)
const entry = z.object({
  id: articleIdSchema,
  title: z.string().max(1000),
  parentId: articleIdSchema.nullable(),
  revision: z.uuid(),
  digest,
  updatedAt: date,
  deleted: z.boolean(),
}).strict()
const vaultSchema = z.object({
  schemaVersion: z.literal(1),
  vaultId: z.string().max(500).regex(/^\d+:.+$/),
  head: gitShaSchema.nullable(),
  entries: z.array(entry).max(10000),
}).strict().refine(v => new Set(v.entries.map(e => e.id)).size === v.entries.length)

export function parsePrivateArticle(input: unknown): PrivateArticle {
  const article = articleSchema.parse(input)
  const bytes = new TextEncoder().encode(JSON.stringify(article)).length
  if (bytes > MAX_SYNC_JSON || bytes + article.assets.reduce((sum, a) => sum + a.size, 0) > MAX_SYNC_EXPANDED)
    throw new Error('Article exceeds sync size limit')
  assertNoCssResources(article.theme.css)
  assertNoCssResources(article.theme.customCss ?? '')
  assertNoCssResources(article.theme.codeCss)
  return article
}

export function parseVaultState(input: unknown): VaultState {
  return vaultSchema.parse(input)
}

export function parseCommitRequest(input: unknown): CommitArticleRequest {
  const request = z.object({ baseRevision: z.uuid().nullable(), operationId: z.uuid(), article: z.unknown() }).strict().parse(input)
  return { ...request, article: parsePrivateArticle(request.article) }
}

export function parseStoredArticle(input: unknown): StoredPrivateArticle {
  const stored = z.object({ article: z.unknown(), revision: z.uuid(), digest, operationId: z.uuid() }).strict().parse(input)
  return { ...stored, article: parsePrivateArticle(stored.article) }
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]))
  return value
}

export async function articleDigest(article: PrivateArticle): Promise<string> {
  const { updatedAt: _time, assets, ...content } = parsePrivateArticle(article)
  const data = { ...content, assets: assets.map(({ blobSha: _sha, proof: _proof, ...asset }) => asset).sort((a, b) => a.path.localeCompare(b.path)) }
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(canonical(data))))
}
