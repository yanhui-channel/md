import type { CommitArticleRequest, StoredPrivateArticle } from '@md/shared/types/private-sync'
import type { BrowserContext, Page, Route } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import process from 'node:process'
import { articleDigest, parsePrivateArticle, parseStoredArticle } from '@md/shared/utils/private-sync'
import { expect } from '@playwright/test'

const origins = new WeakMap<BrowserContext, string>()
export class PrivateApi {
  vaultId = '123:main'
  authorized = true
  commits: CommitArticleRequest[] = []
  articles = new Map<string, StoredPrivateArticle>()
  versions = new Map<string, Map<string, StoredPrivateArticle>>()
  assets = new Map<string, Buffer>()
  beforeCommit: (() => Promise<void>) | null = null
  server: ReturnType<typeof createServer> | undefined
  contexts = new Set<BrowserContext>()
  pageErrors: string[] = []
  externalRequests: string[] = []
  workerVersion = 0
  get head() { return String(this.commits.length + 1).padStart(40, '0') }
  get origin() { return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}` }
  async attach(context: BrowserContext) {
    const capture = (page: Page) => page.on('pageerror', error => this.pageErrors.push(error.message))
    context.pages().forEach(capture)
    context.on('page', capture)
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1')
        this.externalRequests.push(request.url())
    })
    // WebKit cannot route service-worker-owned requests; use a real loopback server.
    if (!this.server) {
      this.server = createServer(async (incoming, outgoing) => {
        try {
          if (!incoming.url?.startsWith('/api/')) {
            const response = await fetch(`http://127.0.0.1:${process.env.PRIVATE_TEST_PORT ?? 5196}${incoming.url}`)
            outgoing.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' })
            outgoing.end(incoming.url === '/private-sw.js'
              ? (await response.text()).replace('manifest.version}', `manifest.version}-${this.workerVersion}`)
              : Buffer.from(await response.arrayBuffer()))
            return
          }
          const chunks: Buffer[] = []
          for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
          const body = Buffer.concat(chunks)
          await this.handle({
            request: () => ({ url: () => `http://${incoming.headers.host}${incoming.url}`, method: () => incoming.method!, headers: () => incoming.headers, postDataBuffer: () => body, postDataJSON: () => JSON.parse(body.toString()) }),
            fulfill: async (reply: any) => {
              outgoing.writeHead(reply.status ?? 200, { ...reply.headers, 'content-type': reply.contentType })
              outgoing.end(reply.body)
            },
          } as unknown as Route)
        }
        catch (error) { outgoing.writeHead(500); outgoing.end(String(error)) }
      })
      await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve))
    }
    origins.set(context, this.origin)
    this.contexts.add(context)
    context.on('close', () => {
      this.contexts.delete(context)
      if (!this.contexts.size) { this.server?.closeAllConnections(); this.server?.close() }
    })
  }

  async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(data) })
    if (!this.authorized)
      return reply({ error: 'login_required' }, 401)
    if (url.pathname === '/api/me')
      return reply({ ownerId: '1', login: 'test-owner', vaultId: this.vaultId, csrfToken: 'test-csrf' })
    if (request.method() !== 'GET' && request.headers()['x-csrf-token'] !== 'test-csrf')
      return reply({ error: 'invalid_origin_or_csrf' }, 403)
    if (url.pathname === '/api/vault')
      return reply({ schemaVersion: 1, vaultId: this.vaultId, head: this.head, entries: [...this.articles.values()].map(s => ({ id: s.article.id, title: s.article.title, parentId: s.article.parentId, updatedAt: s.article.updatedAt, revision: s.revision, digest: s.digest, deleted: s.article.deleted })) })
    const asset = url.pathname.match(/^\/api\/(assets\/[a-f\d]{64}\.(?:png|jpeg|jpg|webp|gif))$/)
    if (asset) {
      if (request.method() === 'PUT') {
        const bytes = request.postDataBuffer()!
        this.assets.set(asset[1], bytes)
        return reply({ path: asset[1], sha256: createHash('sha256').update(bytes).digest('hex'), mime: request.headers()['content-type'], size: bytes.length, blobSha: 'a'.repeat(40), proof: 'b'.repeat(64) })
      }
      return route.fulfill({ body: this.assets.get(asset[1])!, contentType: 'image/png', headers: { 'cache-control': 'no-store' } })
    }
    const article = url.pathname.match(/^\/api\/articles\/([^/]+)(\/history)?$/)
    if (article) {
      const id = decodeURIComponent(article[1])
      if (article[2])
        return reply({ entries: [...this.versions].filter(([, docs]) => docs.has(id)).map(([head, docs]) => ({ head, updatedAt: docs.get(id)!.article.updatedAt })).reverse(), nextPage: null })
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as CommitArticleRequest
        body.article = parsePrivateArticle(body.article)
        const current = this.articles.get(id)
        const digest = await articleDigest(body.article)
        if (current?.operationId === body.operationId && current.digest === digest)
          return reply({ head: this.head, stored: current })
        if ((current?.revision ?? null) !== body.baseRevision)
          return reply({ error: 'article_conflict', detail: { head: this.head, stored: current ?? null } }, 409)
        const hook = this.beforeCommit; this.beforeCommit = null
        if (hook)
          await hook()
        this.commits.push(body)
        const stored = parseStoredArticle({ article: body.article, revision: body.operationId, operationId: body.operationId, digest })
        this.articles.set(id, stored); this.versions.set(this.head, structuredClone(this.articles))
        return reply({ head: this.head, stored })
      }
      const stored = this.versions.get(url.searchParams.get('head') ?? '')?.get(id) ?? this.articles.get(id)
      return stored ? reply(stored) : reply({ error: 'article_not_found' }, 404)
    }
    if (url.pathname === '/api/logout')
      return reply({ ok: true })
    return reply({ error: 'not_found' }, 404)
  }
}
export async function start(page: Page) {
  await page.goto(origins.get(page.context())!)
  await expect(page.locator('#app-initial-loader')).toHaveCount(0)
  await expect(page.locator('.visual-editor .tiptap')).toBeVisible()
  await page.waitForFunction(() => (document.querySelector('#app') as any).__vue_app__?.config.globalProperties.$pinia?._s.get('privateSync')?.identity)
  await call(page, 'privateSync', 'pause')
}
export async function call(page: Page, store: string, method: string, args: unknown[] = []) {
  return page.evaluate(async ({ store, method, args }) => {
    const pinia = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia
    return await pinia._s.get(store)[method](...args)
  }, { store, method, args })
}
export async function currentId(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('post').currentPostId)
}
export async function edit(page: Page, text: string) {
  await call(page, 'editor', 'importContent', [text])
  await call(page, 'privateSync', 'save')
}
export async function addImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20
    canvas.getContext('2d')!.fillRect(0, 0, 20, 20)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!)))
    const editor = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('editor')
    editor.visualEditor.commands.insertContentAt(editor.visualEditor.state.doc.content.size, { type: 'paragraph' })
    editor.visualEditor.commands.focus('end')
    editor.activeTarget = 'visual'; await editor.addImages([new File([blob], 'synthetic.png', { type: 'image/png' })])
    editor.visualEditor.commands.updateAttributes('image', { width: 160, align: 'center' })
  })
}
export async function sync(page: Page) { await call(page, 'privateSync', 'syncNow'); await call(page, 'privateSync', 'pause') }
export async function upload(page: Page) {
  const id = await currentId(page)
  await call(page, 'privateSync', 'selectArticles', [[id]])
  await sync(page)
  return id
}
export async function readRows(page: Page, store = 'meta'): Promise<any[]> {
  return page.evaluate(store => new Promise((resolve, reject) => {
    const opening = indexedDB.open('doocs-md')
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const db = opening.result
      const tx = db.transaction(store)
      const rows = tx.objectStore(store).getAll()
      tx.oncomplete = () => { db.close(); resolve(rows.result) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }), store)
}
export async function record(page: Page, id: string) {
  return JSON.parse((await readRows(page)).find(r => r.key === `private:sync:123:main:${id}`)?.value ?? '{}')
}
