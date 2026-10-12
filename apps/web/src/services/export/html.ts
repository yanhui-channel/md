import type { Publication } from './publication'
import { generatePureHTML } from '@md/core/utils'
import { sanitizeTitle } from '@md/shared/utils/basicHelpers'
import { downloadFile } from '@md/shared/utils/fileHelpers'
import { rewriteImageReferences } from '@/lib/visual/assets'
import { sanitizeRenderedHtml } from '@/lib/visual/source-preview'
import { EXPORT_LAYOUT_CSS } from './apply-export-layout'
import { getHtmlContent } from './html-content'
import { assertPublicationComplete, preparePublication } from './publication'
import { SHARE_SHELL_VARS_CSS, snapshotStyles } from './share-styles'

/** Export rendered HTML content. */
export async function exportHTML(title: string = `untitled`) {
  const publication = await preparePublication('light')
  try {
    assertPublicationComplete(publication)
    title = publication.snapshot.title
    downloadFile(buildPublicationHtml(publication), `${sanitizeTitle(title)}.html`, `text/html`)
  }
  finally { publication.dispose() }
}

export function buildPublicationHtml(publication: Publication, relativeImages = false): string {
  const root = publication.root.cloneNode(true) as HTMLElement
  if (relativeImages)
    root.querySelectorAll<HTMLImageElement>('img[data-local-src]').forEach((img) => { img.src = img.dataset.localSrc! })
  const htmlStr = getHtmlContent({ root, staticLayout: true })
  const stylesToAdd = snapshotStyles(publication.theme)

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sanitizeTitle(publication.snapshot.title)}</title>
  <style>${SHARE_SHELL_VARS_CSS}</style>
  ${stylesToAdd}
  <style>${EXPORT_LAYOUT_CSS}</style>
</head>
<body>
  <div style="width: 100%; max-width: 750px; box-sizing: border-box; margin: auto; padding: 20px;">
    ${htmlStr}
  </div>
</body>
</html>`

  return fullHtml
}

export { generatePureHTML }

/** Export unstyled HTML file. */
export async function exportPureHTML(raw: string, title: string = `untitled`) {
  const publication = await preparePublication('light')
  try {
    assertPublicationComplete(publication)
    title = publication.snapshot.title
    raw = await purePublicationHtml(publication)
    downloadFile(raw, `${sanitizeTitle(title)}.html`, `text/html`)
  }
  finally { publication.dispose() }
}

export async function purePublicationHtml(publication: Publication) {
  const replacements: Record<string, string> = {}
  publication.root.querySelectorAll<HTMLImageElement>('img[data-local-src]').forEach((img) => { replacements[img.dataset.localSrc!] = img.src })
  return sanitizeRenderedHtml(await generatePureHTML(rewriteImageReferences(publication.snapshot.markdown, replacements)))
}
