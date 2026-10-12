// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { defaultPerThemeSettings } from '@md/shared/configs'
import { strToU8, unzipSync, Zip, ZipPassThrough, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sha256, validateAsset } from '@/storage/repositories/assets'
import { checkBundleBudget, exportArticleBundle, readArticleBundle, restoreArticleBundle, validateBundlePath } from './article-bundle'

const state = vi.hoisted(() => ({ restore: vi.fn(), assets: new Map() }))
vi.mock('@/services/export/html', () => ({ buildPublicationHtml: () => '<article>offline</article>' }))
vi.mock('@/storage/db', () => ({ getDatabase: async () => ({ get: async (_store: string, path: string) => state.assets.get(path) }) }))
vi.mock('@/stores/editor', () => ({ useEditorStore: vi.fn() }))
vi.mock('@/stores/post', () => ({ usePostStore: () => ({ restoreArticle: state.restore }) }))
vi.mock('@/stores/theme', () => ({ useThemeStore: vi.fn() }))
vi.mock('@/stores/cssEditor', () => ({ useCssEditorStore: vi.fn() }))
vi.mock('@/stores/marketplace', () => ({ useMarketplaceStore: vi.fn() }))
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }))
})
afterAll(() => vi.unstubAllGlobals())
const theme = () => ({ id: 'mp:yanhui-channel', settings: defaultPerThemeSettings(), css: '#output p { color: #333 }', codeCss: '.hljs { color: #333 }', previewWidth: 'w-[375px]', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false })
async function fixture() {
  const markdown = '# 原稿\n\n内容不丢失'
  return { version: 1 as const, title: '原稿', markdown, markdownSha256: await sha256(new Blob([markdown])), theme: theme(), assets: [], external: [], missing: [] }
}
function archive(bundle: Awaited<ReturnType<typeof fixture>>, extra = {}) {
  const { markdown, ...manifest } = bundle
  return new File([zipSync({ 'article.md': strToU8(markdown), 'article.html': strToU8('<p>text</p>'), 'manifest.json': strToU8(JSON.stringify(manifest)), ...extra })], 'article.zip')
}
describe('bounded article backups', () => {
  it('reads a valid archive and rejects changed Markdown or undeclared files', async () => {
    const bundle = await fixture()
    expect((await readArticleBundle(archive(bundle))).markdown).toBe(bundle.markdown)
    await expect(readArticleBundle(archive({ ...bundle, markdown: 'tampered' }))).rejects.toThrow('正文校验')
    await expect(readArticleBundle(archive(bundle, { [`assets/${'a'.repeat(64)}.png`]: strToU8('unused') }))).rejects.toThrow('清单')
  })
  it('revalidates direct restore input before touching posts', async () => {
    await expect(restoreArticleBundle({ ...await fixture(), markdown: 'changed' })).rejects.toThrow('正文校验')
    await expect(restoreArticleBundle({ ...await fixture(), theme: { ...theme(), css: '#output:is(*) + header {display:none}' } })).rejects.toThrow()
    expect(state.restore).not.toHaveBeenCalled()
  })
  it('rejects duplicate ZIP paths during streaming, before manifest processing', async () => {
    const chunks: Uint8Array[] = []
    const zip = new Zip((err, bytes) => {
      if (err)
        throw err; chunks.push(bytes)
    })
    for (let n = 0; n < 2; n++) { const file = new ZipPassThrough('article.md'); zip.add(file); file.push(strToU8('duplicate'), true) }
    zip.end()
    await expect(readArticleBundle(new File(chunks.map(c => new Uint8Array(c)), 'duplicate.zip'))).rejects.toThrow('重复路径')
  })
  it('exports only referenced assets, preserves original bytes, and omits secrets/history', async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const asset = await validateAsset(new File([bytes], 'photo.png', { type: 'image/png' }))
    state.assets.set(asset.path, asset)
    state.assets.set('unused.png', asset)
    const publication = { snapshot: { title: '备份', markdown: `![photo](${asset.path})`, secret: 'secret', history: ['history'] }, theme: theme() }
    const blob = await exportArticleBundle(publication as any)
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(['article.md', 'article.html', 'manifest.json', asset.path].sort())
    const json = new TextDecoder().decode(entries['manifest.json'])
    expect(json).not.toMatch(/"(?:secret|history|blob|postId)"/)
    const restored = await readArticleBundle(new File([blob], 'backup.zip'))
    expect(await restored.assets[0].blob.arrayBuffer()).toEqual(bytes.buffer)
    entries[asset.path] = new Uint8Array([...bytes.slice(0, -1), 1])
    await expect(readArticleBundle(new File([zipSync(entries)], 'tampered.zip'))).rejects.toThrow('摘要')
  })
  it('rejects oversized declared files before inflation', async () => {
    const bytes = zipSync({ 'article.md': strToU8('small') })
    new DataView(bytes.buffer).setUint32(22, 100 * 1024 * 1024 + 1, true)
    await expect(readArticleBundle(new File([bytes], 'bomb.zip'))).rejects.toThrow('限制')
  })
  it.each(['../x', '/x', 'assets\\x.png', 'a/../../b', 'C:/x', 'assets/a/../b', 'manifest.json/else'])('rejects traversal or unapproved path %s', (path) => {
    expect(() => validateBundlePath(path)).toThrow()
  })
  it('checks exact size and entry boundaries without allocating huge buffers', () => {
    expect(() => checkBundleBudget(50 * 1024 * 1024, 100 * 1024 * 1024, 500)).not.toThrow()
    expect(() => checkBundleBudget(50 * 1024 * 1024 + 1, 0, 0)).toThrow()
    expect(() => checkBundleBudget(1, 100 * 1024 * 1024 + 1, 0)).toThrow()
    expect(() => checkBundleBudget(1, 1, 501)).toThrow()
  })
  it('rejects invalid manifests and hostile paths before restore', async () => {
    const data = zipSync({ '../x': strToU8('x'), 'manifest.json': strToU8('{"version":99}') })
    const file = new File([data], 'bad.zip')
    await expect(readArticleBundle(file)).rejects.toThrow()
    await expect(restoreArticleBundle({ version: 99 } as any)).rejects.toThrow()
  })
})
