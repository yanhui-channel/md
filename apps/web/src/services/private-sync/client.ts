import type { CommitArticleRequest, CommitArticleResult, HistoryPage, PrivateAsset, VaultState } from '@md/shared/types/private-sync'
import { gitShaSchema, MAX_SYNC_ASSET, parseStoredArticle, parseVaultState, privateAssetSchema } from '@md/shared/utils/private-sync'
import { z } from 'zod'

export class PrivateSyncError extends Error {
  constructor(public code: string, public status = 0, public detail?: unknown, public retryAfter = 0) { super(code) }
}
const meSchema = z.object({ ownerId: z.string().regex(/^\d+$/), login: z.string(), vaultId: z.string().regex(/^\d+:.+$/), csrfToken: z.string().min(1) })
export type PrivateIdentity = z.infer<typeof meSchema>
export class PrivateSyncClient {
  private csrf = ''
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`/api/${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90_000), headers: { ...init.headers, ...(init.method ? { 'x-csrf-token': this.csrf } : {}) } })
    }
    catch { throw new PrivateSyncError('network_unavailable') }
    if (response.ok || response.status === 304)
      return response
    const error = await response.json().catch(() => ({}))
    const retry = response.headers.get('retry-after')
    const retryAfter = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0
    throw new PrivateSyncError(typeof error.error === 'string' ? error.error : 'sync_failed', response.status, error.detail, Math.max(0, retryAfter || 0))
  }

  async me(): Promise<PrivateIdentity> {
    const identity = meSchema.parse(await (await this.request('me')).json())
    this.csrf = identity.csrfToken
    return identity
  }

  async readVault(etag?: string): Promise<{ state: VaultState | null, etag: string }> {
    const response = await this.request('vault', { headers: etag ? { 'If-None-Match': etag } : {} })
    return { state: response.status === 304 ? null : parseVaultState(await response.json()), etag: response.headers.get('etag') ?? '' }
  }

  async readArticle(id: string, head: string) { return parseStoredArticle(await (await this.request(`articles/${encodeURIComponent(id)}?head=${encodeURIComponent(head)}`)).json()) }
  async uploadAsset(asset: PrivateAsset, bytes: Blob): Promise<PrivateAsset> {
    const result = privateAssetSchema.parse(await (await this.request(asset.path, { method: 'PUT', body: bytes, headers: { 'Content-Type': asset.mime } })).json())
    if (result.path !== asset.path || result.size !== asset.size || result.mime !== asset.mime || !result.blobSha || !result.proof)
      throw new PrivateSyncError('invalid_asset')
    return result
  }

  async readAsset(path: string, head: string): Promise<ArrayBuffer> {
    const response = await this.request(`${path}?head=${encodeURIComponent(head)}`)
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const part = await reader.read()
      if (part.done)
        break
      size += part.value.length
      if (size > MAX_SYNC_ASSET) { await reader.cancel(); throw new PrivateSyncError('asset_size_limit') }
      chunks.push(part.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes.buffer
  }

  async commitArticle(request: CommitArticleRequest): Promise<CommitArticleResult> {
    const result = await (await this.request(`articles/${encodeURIComponent(request.article.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })).json()
    return { head: gitShaSchema.parse(result.head), stored: parseStoredArticle(result.stored) }
  }

  async listHistory(id: string, page = 1): Promise<HistoryPage> {
    return z.object({ entries: z.array(z.object({ head: gitShaSchema, updatedAt: z.iso.datetime() })).max(20), nextPage: z.number().int().positive().nullable() }).parse(await (await this.request(`articles/${encodeURIComponent(id)}/history?page=${page}`)).json())
  }

  async logout() {
    try { await this.request('logout', { method: 'POST' }) }
    finally { this.csrf = '' }
  }
}
