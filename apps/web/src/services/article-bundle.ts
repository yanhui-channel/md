import type { Publication } from './export/publication'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import type { StoredAsset } from '@/storage/repositories/assets'
import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from 'fflate'
import { z } from 'zod'
import { collectImageReferences } from '@/lib/visual/assets'
import { validateThemeSnapshot } from '@/lib/visual/theme-snapshot'
import { assetRepo, LOCAL_ASSET_PATTERN, MAX_ASSET_SIZE, sha256, validateAsset } from '@/storage/repositories/assets'

export interface ArticleBundle {
  version: 1
  title: string
  markdown: string
  markdownSha256: string
  theme: ThemeSnapshot
  assets: StoredAsset[]
  external: string[]
  missing: string[]
}

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const assetSchema = z.object({ path: z.string().regex(LOCAL_ASSET_PATTERN), sha256: digest, mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), size: z.number().int().positive().max(MAX_ASSET_SIZE) })
const manifestSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(1000),
  markdownSha256: digest,
  theme: z.unknown(),
  assets: z.array(assetSchema).max(497),
  external: z.array(z.string().max(4096)).max(500),
  missing: z.array(z.string().max(4096)).max(500),
})

export function validateBundlePath(path: string) {
  if (!['article.md', 'article.html', 'manifest.json'].includes(path) && !LOCAL_ASSET_PATTERN.test(path))
    throw new Error(`备份包含不支持的路径：${path}`)
}

export function checkBundleBudget(compressed: number, expanded: number, entries: number) {
  if (![compressed, expanded, entries].every(value => Number.isSafeInteger(value) && value >= 0)
    || compressed > 50 * 1024 * 1024 || expanded > 100 * 1024 * 1024 || entries > 500) {
    throw new Error('备份超过限制（压缩包 50 MB、解压后 100 MB、500 个文件）')
  }
}

function resources(markdown: string, paths: Set<string>) {
  const refs = collectImageReferences(markdown)
  return {
    external: refs.filter(path => /^(?:https?:|\/\/)/i.test(path)),
    missing: refs.filter(path => !paths.has(path) && !/^(?:https?:|\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(path)),
  }
}

async function validateBundle(value: ArticleBundle): Promise<ArticleBundle> {
  const manifest = manifestSchema.parse(value)
  const theme = validateThemeSnapshot(manifest.theme)
  if (typeof value.markdown !== 'string')
    throw new Error('文章正文校验失败')
  let total = new Blob([value.markdown, JSON.stringify(manifest)]).size
  checkBundleBudget(0, total, manifest.assets.length + 3)
  if (await sha256(new Blob([value.markdown])) !== manifest.markdownSha256)
    throw new Error('文章正文校验失败')
  const paths = new Set<string>()
  const refs = new Set(collectImageReferences(value.markdown))
  const assets: StoredAsset[] = []
  for (let index = 0; index < manifest.assets.length; index++) {
    const meta = manifest.assets[index]
    if (paths.has(meta.path) || !refs.has(meta.path))
      throw new Error('备份存在重复或未引用的图片')
    paths.add(meta.path)
    const blob = value.assets[index].blob
    if (!(blob instanceof Blob) || blob.size !== meta.size)
      throw new Error('图片大小校验失败')
    total += blob.size
    checkBundleBudget(0, total, assets.length + 4)
    const checked = await validateAsset(new File([blob], meta.path, { type: meta.mime }))
    if (checked.path !== meta.path || checked.sha256 !== meta.sha256 || checked.mime !== meta.mime)
      throw new Error('图片摘要或格式校验失败')
    assets.push(checked)
  }
  const actual = resources(value.markdown, paths)
  for (const key of ['external', 'missing'] as const) {
    if (JSON.stringify([...actual[key]].sort()) !== JSON.stringify([...manifest[key]].sort()))
      throw new Error('图片清单与正文不一致')
  }
  return { ...manifest, theme, assets, markdown: value.markdown }
}

export async function exportArticleBundle(publication: Publication): Promise<Blob> {
  const { buildPublicationHtml } = await import('./export/html')
  const markdown = publication.snapshot.markdown
  const assets: StoredAsset[] = []
  for (const path of collectImageReferences(markdown).filter(path => LOCAL_ASSET_PATTERN.test(path))) {
    const asset = await assetRepo.get(path)
    if (asset)
      assets.push(asset)
  }
  const bundle = await validateBundle({ version: 1, title: publication.snapshot.title, markdown, markdownSha256: await sha256(new Blob([markdown])), theme: publication.theme, assets, ...resources(markdown, new Set(assets.map(asset => asset.path))) })
  const { markdown: _, ...metadata } = bundle
  const manifest = { ...metadata, assets: assets.map(({ blob: _, ...meta }) => meta) }
  const files: Record<string, Uint8Array> = {
    'article.md': strToU8(markdown),
    'article.html': strToU8(buildPublicationHtml(publication, true)),
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  }
  for (const asset of assets) files[asset.path] = new Uint8Array(await asset.blob.arrayBuffer())
  checkBundleBudget(0, Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0), Object.keys(files).length)
  const zipped = zipSync(files, { level: 6 })
  checkBundleBudget(zipped.length, 0, Object.keys(files).length)
  return new Blob([zipped], { type: 'application/zip' })
}

export async function readArticleBundle(file: File): Promise<ArticleBundle> {
  checkBundleBudget(file.size, 0, 0)
  const input = new Uint8Array(await file.arrayBuffer())
  const files = new Map<string, Uint8Array>()
  const names = new Set<string>()
  let expanded = 0
  let failure: Error | undefined
  const decoder = new Unzip((entry) => {
    validateBundlePath(entry.name)
    if (names.has(entry.name))
      throw new Error('备份存在重复路径')
    names.add(entry.name)
    checkBundleBudget(input.length, expanded + (entry.originalSize ?? 0), names.size)
    const max = entry.name.startsWith('assets/') ? MAX_ASSET_SIZE : 30 * 1024 * 1024
    if ((entry.originalSize ?? 0) > max)
      throw new Error('备份文件过大')
    const chunks: Uint8Array[] = []
    let length = 0
    entry.ondata = (error, bytes, final) => {
      if (failure)
        return
      try {
        if (error)
          throw error
        length += bytes.length
        expanded += bytes.length
        checkBundleBudget(input.length, expanded, names.size)
        if (length > max)
          throw new Error('备份文件过大')
        chunks.push(bytes)
        if (final) {
          const full = new Uint8Array(length)
          let offset = 0
          for (const chunk of chunks) { full.set(chunk, offset); offset += chunk.length }
          files.set(entry.name, full)
        }
      }
      catch (error) { failure = error as Error; entry.terminate() }
    }
    entry.start()
  })
  decoder.register(UnzipInflate)
  for (let offset = 0; offset < input.length; offset += 16384) {
    decoder.push(input.subarray(offset, offset + 16384), offset + 16384 >= input.length)
    if (failure)
      throw failure
  }
  if (files.size !== names.size || !files.has('article.md') || !files.has('article.html') || !files.has('manifest.json'))
    throw new Error('备份不完整')
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(files.get('manifest.json')!)))
  if (files.size !== manifest.assets.length + 3)
    throw new Error('备份资源清单不一致')
  return validateBundle({ ...manifest, theme: manifest.theme as ThemeSnapshot, markdown: strFromU8(files.get('article.md')!), assets: manifest.assets.map((asset) => {
    const bytes = files.get(asset.path)
    if (!bytes)
      throw new Error('备份缺少图片')
    return { ...asset, blob: new Blob([new Uint8Array(bytes)], { type: asset.mime }) }
  }) })
}

export async function restoreArticleBundle(bundle: ArticleBundle): Promise<string> {
  const checked = await validateBundle(bundle)
  const { usePostStore } = await import('@/stores/post')
  const { useEditorStore } = await import('@/stores/editor')
  await useEditorStore().visualSession?.flush()
  const id = crypto.randomUUID()
  const now = new Date()
  await usePostStore().restoreArticle({ id, title: checked.title, content: checked.markdown, history: [], createDatetime: now, updateDatetime: now, themeId: `MD__article_theme:${id}` }, checked.assets, checked.theme)
  return id
}
