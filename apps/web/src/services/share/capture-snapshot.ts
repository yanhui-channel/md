import { getHtmlContent } from '@/services/export/html-content'
import { assertPublicationComplete, preparePublication } from '@/services/export/publication'
import { scopeThemeCss, SHARE_SHELL_VARS_CSS } from '@/services/export/share-styles'

/** Local snapshot only; this does not enable or send a share. */
export async function captureShareSnapshot(): Promise<{ bodyHtml: string, stylesHtml: string }> {
  const publication = await preparePublication('light')
  try {
    assertPublicationComplete(publication)
    return {
      bodyHtml: getHtmlContent({ root: publication.root }),
      stylesHtml: `<style>${SHARE_SHELL_VARS_CSS}\n${scopeThemeCss(publication.theme.css, '.share-content')}\n${publication.theme.codeCss}</style>`,
    }
  }
  finally { publication.dispose() }
}
