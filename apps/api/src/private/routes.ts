import type { PrivateContext } from './types'
import { MAX_SYNC_ASSET, MAX_SYNC_JSON, parseCommitRequest } from '@md/shared/utils/private-sync'
import { Hono } from 'hono'
import { storeAsset } from './assets'
import { commitArticle, listArticleHistory, readArticle, readAsset, readVault } from './repository'
import { SyncError } from './types'

async function boundedBody(request: Request, limit: number): Promise<ArrayBuffer> {
  const reader = request.body?.getReader()
  if (!reader)
    throw new SyncError('empty_body', 400)
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const value = await reader.read()
    if (value.done)
      break
    length += value.value.length
    if (length > limit) { await reader.cancel(); throw new SyncError('request_too_large', 413) }
    chunks.push(value.value)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result.buffer
}

export const privateRoutes = new Hono<PrivateContext>()
privateRoutes.get('/vault', async (c) => {
  const state = await readVault(c.env)
  const etag = `"${state.head}"`
  c.header('ETag', etag)
  return c.req.header('If-None-Match') === etag ? c.body(null, 304) : c.json(state)
})
privateRoutes.get('/articles/:id/history', async c => c.json(await listArticleHistory(c.env, c.req.param('id'), Number(c.req.query('page') ?? 1))))
privateRoutes.get('/articles/:id', async c => c.json(await readArticle(c.env, c.req.param('id'), c.req.query('head') ?? '')))
privateRoutes.put('/articles/:id', async (c) => {
  const request = parseCommitRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await boundedBody(c.req.raw, MAX_SYNC_JSON))))
  if (request.article.id !== c.req.param('id'))
    throw new SyncError('article_id_mismatch', 422)
  return c.json(await commitArticle(c.env, request))
})
privateRoutes.put('/assets/:name', async c => c.json(await storeAsset(c.env, `assets/${c.req.param('name')}`, await boundedBody(c.req.raw, MAX_SYNC_ASSET))))
privateRoutes.get('/assets/:name', async (c) => {
  const asset = await readAsset(c.env, `assets/${c.req.param('name')}`, c.req.query('head') ?? '')
  return new Response(new Uint8Array(asset.bytes).buffer, { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
})
