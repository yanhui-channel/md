import type { PrivateEnv } from './types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { parsePrivateArticle } from '@md/shared/utils/private-sync'

export const testEnv: PrivateEnv = {
  APP_ORIGIN: 'https://editor.example',
  ALLOWED_GITHUB_USER_ID: '123',
  DATA_REPO_OWNER: 'owner',
  DATA_REPO_NAME: 'articles',
  DATA_REPO_BRANCH: 'main',
  GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  DATA_REPO_TOKEN: 'test-repo-token',
  SESSION_SECRET: 'test-only-signing-secret-at-least-32-chars',
  ASSETS: { fetch: async () => new Response('shell') },
}
export function testArticle(id = 'article-1') {
  return parsePrivateArticle({
    id,
    title: 'Test article',
    parentId: null,
    markdown: '# Test',
    theme: { id: 'yanhui', settings: { primaryColor: '#4285f4', linkColor: '#4285f4', blockquoteBackground: '#f5f6f8', fontFamily: 'sans-serif', fontSize: '17px', lineHeight: '1.75', blockSpacing: '1', codeBlockTheme: '/yanhui-code.css', headingStyles: {}, isShowLineNumber: false, isMacCodeBlock: true }, css: '#output p {color:#333}', codeCss: '', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false },
    assets: [],
    external: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    deleted: false,
  })
}

export class GitFixture {
  blobs = new Map<string, Uint8Array>()
  trees = new Map<string, Record<string, string>>()
  commits = new Map<string, { tree: { sha: string }, parents: { sha: string }[] }>()
  head = ''
  private = true
  beforeUpdate?: () => Promise<void>
  createdCommits: string[] = []
  forceUpdates = 0
  constructor() { this.edit('README.md', 'Private article repository') }
  hash(data: unknown) { return createHash('sha1').update(JSON.stringify(data)).digest('hex') }
  blob(bytes: Uint8Array) {
    const sha = this.hash([...bytes])
    this.blobs.set(sha, bytes)
    return sha
  }

  tree(files: Record<string, string>) {
    const sha = this.hash(files)
    this.trees.set(sha, files)
    return sha
  }

  files() { return this.head ? this.trees.get(this.commits.get(this.head)!.tree.sha)! : {} }
  edit(path: string, content: string) {
    const tree = this.tree({ ...this.files(), [path]: this.blob(new TextEncoder().encode(content)) })
    const commit = { tree: { sha: tree }, parents: this.head ? [{ sha: this.head }] : [] }
    this.head = this.hash(commit)
    this.commits.set(this.head, commit)
  }

  text(path: string) { return new TextDecoder().decode(this.blobs.get(this.files()[path])) }
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const path = url.pathname.replace('/repos/owner/articles', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (!path)
      return Response.json({ id: 456, private: this.private, permissions: { push: true } })
    if (path.startsWith('/git/ref/'))
      return this.head ? Response.json({ object: { sha: this.head } }) : Response.json({}, { status: 409 })
    if (path.startsWith('/git/refs/') && method === 'PATCH') {
      const hook = this.beforeUpdate
      this.beforeUpdate = undefined
      await hook?.()
      if (body.force !== false)
        this.forceUpdates++
      const commit = this.commits.get(body.sha)
      if (!commit?.parents.some(p => p.sha === this.head))
        return Response.json({}, { status: 409 })
      this.head = body.sha
      return Response.json({ object: { sha: this.head } })
    }
    if (path === '/git/blobs' && method === 'POST') {
      const bytes = body.encoding === 'base64' ? new Uint8Array(Buffer.from(body.content, 'base64')) : new TextEncoder().encode(body.content)
      return Response.json({ sha: this.blob(bytes) })
    }
    if (path.startsWith('/git/blobs/')) {
      const sha = path.split('/').at(-1)!
      const bytes = this.blobs.get(sha)
      return bytes ? Response.json({ sha, size: bytes.length, encoding: 'base64', content: Buffer.from(bytes).toString('base64') }) : Response.json({}, { status: 404 })
    }
    if (path === '/git/trees' && method === 'POST') {
      const files = { ...this.trees.get(body.base_tree) }
      for (const item of body.tree) files[item.path] = item.sha ?? this.blob(new TextEncoder().encode(item.content))
      return Response.json({ sha: this.tree(files) })
    }
    if (path.startsWith('/git/trees/')) {
      const files = this.trees.get(path.split('/').at(-1)!)
      return files ? Response.json({ truncated: false, tree: Object.entries(files).map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644', size: this.blobs.get(sha)!.length })) }) : Response.json({}, { status: 404 })
    }
    if (path === '/git/commits' && method === 'POST') {
      const commit = { tree: { sha: body.tree }, parents: body.parents.map((sha: string) => ({ sha })) }
      const sha = this.hash({ ...commit, message: body.message })
      this.commits.set(sha, commit)
      this.createdCommits.push(sha)
      return Response.json({ sha })
    }
    if (path.startsWith('/git/commits/')) {
      const commit = this.commits.get(path.split('/').at(-1)!)
      return commit ? Response.json(commit) : Response.json({}, { status: 404 })
    }
    if (path === '/commits') {
      const result = []
      let sha = this.head
      while (sha) {
        const commit = this.commits.get(sha)!
        const files = this.trees.get(commit.tree.sha)!
        const parent = commit.parents[0]?.sha
        const parentFiles = parent ? this.trees.get(this.commits.get(parent)!.tree.sha)! : {}
        if (files[url.searchParams.get('path')!] !== parentFiles[url.searchParams.get('path')!])
          result.push({ sha, commit: { committer: { date: '2026-10-12T00:00:00.000Z' } } })
        sha = parent
      }
      const offset = (Number(url.searchParams.get('page') ?? 1) - 1) * 20
      return Response.json(result.slice(offset, offset + 20))
    }
    throw new Error(`Unexpected GitHub request: ${method} ${path}`)
  }
}
