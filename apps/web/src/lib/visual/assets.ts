import { MarkdownManager } from '@tiptap/markdown'
import { assetRepo, LOCAL_ASSET_PATTERN } from '@/storage/repositories/assets'

const parser = new MarkdownManager({ extensions: [], markedOptions: { gfm: true } }).instance
type Tokens = ReturnType<typeof parser.lexer>
type Token = Tokens[number]

export function collectImageReferences(markdown: string): string[] {
  const references = new Set<string>()
  parser.walkTokens(parser.lexer(markdown), (token) => {
    if (token.type === 'image')
      references.add(token.href)
    if (token.type === 'html') {
      const document = new DOMParser().parseFromString(token.raw, 'text/html')
      document.querySelectorAll('img[src]').forEach(image => references.add(image.getAttribute('src')!))
    }
  })
  return [...references]
}

export function rewriteImageReferences(markdown: string, replacements: Record<string, string>): string {
  function rewriteToken(token: Token): string {
    if (token.type === 'image' && replacements[token.href]) {
      const url = replacements[token.href]
      const title = token.title ? ` "${token.title.replace(/"/g, '&quot;')}"` : ''
      const labelEnd = token.raw.lastIndexOf('](')
      const label = labelEnd >= 0 ? token.raw.slice(0, labelEnd + 1) : `![${token.text}]`
      return `${label}(<${url}>${title})`.replace(/<([^\s<>]+)>/, '$1')
    }
    if (token.type === 'html') {
      const document = new DOMParser().parseFromString(token.raw, 'text/html')
      let changed = false
      document.querySelectorAll('img[src]').forEach((image) => {
        const path = image.getAttribute('src')!
        if (replacements[path]) { image.setAttribute('src', replacements[path]); changed = true }
      })
      return changed ? document.body.innerHTML : token.raw
    }
    const children: Token[] = token.type === 'list'
      ? token.items
      : token.type === 'table'
        ? [...token.header, ...token.rows.flat()].flatMap(cell => cell.tokens)
        : 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : []
    return rewriteChildren(token.raw, children)
  }
  function rewriteChildren(raw: string, children: Token[]): string {
    let offset = 0
    let result = ''
    for (const child of children) {
      const start = raw.indexOf(child.raw, offset)
      if (start < 0)
        continue
      result += raw.slice(offset, start) + rewriteToken(child)
      offset = start + child.raw.length
    }
    return result + raw.slice(offset)
  }
  return rewriteChildren(markdown, parser.lexer(markdown))
}

export async function resolveLocalImage(path: string): Promise<{ url: string, dispose: () => void } | undefined> {
  if (!LOCAL_ASSET_PATTERN.test(path))
    return undefined
  const asset = await assetRepo.get(path)
  if (!asset)
    return undefined
  const url = URL.createObjectURL(asset.blob)
  return { url, dispose: () => URL.revokeObjectURL(url) }
}

/** Resolve only this root's local references; remote images are not downloaded. */
export function hydrateLocalImages(root: HTMLElement): () => void {
  const releases: (() => void)[] = []
  let disposed = false
  for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const path = image.getAttribute('src')!
    if (!LOCAL_ASSET_PATTERN.test(path))
      continue
    image.dataset.localSrc = path
    image.removeAttribute('src')
    void resolveLocalImage(path).then((resolved) => {
      if (disposed) { resolved?.dispose(); return }
      if (resolved) { image.src = resolved.url; releases.push(resolved.dispose) }
      else {
        image.dataset.localMissing = path
      }
    }).catch(() => { image.dataset.localMissing = path })
  }
  return () => { disposed = true; releases.forEach(release => release()) }
}
