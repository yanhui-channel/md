import type { DocumentSnapshot } from '@/lib/visual/session'
import type { ThemeSnapshot } from '@/lib/visual/theme-snapshot'
import { initRenderer } from '@md/core/renderer'
import { contentHasMath, ensureMathJaxLoaded, postProcessHtml, renderMarkdown } from '@md/core/utils'
import { t } from '@/i18n/translate'
import { waitForPreviewReady } from '@/lib/preview/preview-ready'
import { captureThemeSnapshot } from '@/lib/visual/capture-theme'
import { renderStoredCodeBlocks, sanitizeRenderedHtml } from '@/lib/visual/source-preview'
import { resolveAssetUrl } from '@/services/emoji/urlResolver'
import { assetRepo, LOCAL_ASSET_PATTERN } from '@/storage/repositories/assets'
import { useCustomComponentStore } from '@/stores/customComponent'
import { useEditorStore } from '@/stores/editor'
import { decorateArticle } from '@/yanhui/decorate'
import { YANHUI_SAMPLE_ID, YANHUI_THEME } from '@/yanhui/defaults'
import { assets } from '@/yanhui/resources'

export interface Publication {
  snapshot: DocumentSnapshot
  theme: ThemeSnapshot
  themeMode: 'light' | 'dark'
  root: HTMLElement
  external: string[]
  missing: string[]
  dispose: () => void
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function assertPublicationComplete(publication: Publication) {
  if (publication.missing.length)
    throw new Error(`${t('visual.exportMissingImages')}: ${publication.missing.join(', ')}`)
}

export async function preparePublication(themeMode: 'light' | 'dark' = 'light'): Promise<Publication> {
  const session = useEditorStore().visualSession
  if (!session)
    throw new Error(t('visual.notReady'))
  // Export must remain available when local persistence is full or unavailable.
  const components = JSON.parse(JSON.stringify(useCustomComponentStore().registry))
  const snapshot = session.capture()
  const theme = await captureThemeSnapshot()
  const host = document.createElement('div')
  host.dataset.publicationHost = ''
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:750px;pointer-events:none;'
  const root = document.createElement('div')
  root.style.fontFamily = theme.settings.fontFamily
  root.style.fontSize = theme.settings.fontSize
  root.style.lineHeight = theme.settings.lineHeight
  host.append(root)
  const external = new Set<string>()
  const missing = new Set<string>()
  try {
    if (contentHasMath(snapshot.markdown))
      await ensureMathJaxLoaded()
    const renderer = initRenderer({
      themeMode,
      components,
      assetResolver: resolveAssetUrl,
      citeStatus: theme.citeStatus,
      countStatus: theme.countStatus,
      legend: theme.legend,
      isMacCodeBlock: theme.settings.isMacCodeBlock,
      isShowLineNumber: theme.settings.isShowLineNumber,
      renderMessages: { footnoteTitle: t('store.render.footnoteTitle'), unknownComponent: t('store.render.unknownComponent'), katexLoading: t('store.render.katexLoading') },
    })
    const rendered = renderMarkdown(snapshot.markdown, renderer)
    root.innerHTML = sanitizeRenderedHtml(postProcessHtml(renderStoredCodeBlocks(rendered.html, theme.settings.isShowLineNumber), rendered.readingTime, renderer))
    root.querySelectorAll('[contenteditable], textarea, input, button').forEach(el => el.remove())
    root.querySelectorAll('style').forEach((el) => {
      if (!el.closest('svg'))
        el.remove()
    })
    root.querySelectorAll<HTMLElement>('.mac-sign').forEach((el) => { el.style.display = theme.settings.isMacCodeBlock ? 'flex' : 'none' })
    if (theme.id === YANHUI_THEME || theme.id.startsWith('bundle:'))
      decorateArticle(root, assets.avatar)
    if (snapshot.postId === YANHUI_SAMPLE_ID) {
      const images = assets.images as Record<string, string>
      root.querySelectorAll('img').forEach((img) => {
        const original = img.getAttribute('src')!; if (images[original])
          img.src = images[original]
      })
    }
    // Async core diagrams locate their placeholder by id, so mount before awaiting.
    document.body.append(host)
    for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
      const path = image.getAttribute('src')!
      if (LOCAL_ASSET_PATTERN.test(path)) {
        const asset = await assetRepo.get(path)
        if (asset) { image.dataset.localSrc = path; image.src = await blobDataUrl(asset.blob) }
        else { missing.add(path); image.removeAttribute('src') }
      }
      else if (/^(?:https?:|\/\/)/i.test(path)) {
        external.add(path)
      }
      else if (!path.startsWith('data:')) {
        missing.add(path)
      }
    }
    if (!await waitForPreviewReady(undefined, { root, themeMode }))
      throw new Error(t('visual.exportDiagramFailed'))
    root.innerHTML = sanitizeRenderedHtml(root.innerHTML)
    return { snapshot, theme, themeMode, root, external: [...external], missing: [...missing], dispose: () => host.remove() }
  }
  catch (error) { host.remove(); throw error }
}
