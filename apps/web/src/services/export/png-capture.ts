import {
  applyExportLayout,
  getPngCaptureStyles,
  PNG_CAPTURE_ROOT_CLASS,
} from './apply-export-layout'
import { assertPublicationComplete, preparePublication } from './publication'

export type PreviewDevice = `desktop` | `mobile`

export interface OffScreenPreview {
  title: string
  /** The `.preview` shell handed to html-to-image; includes the export padding. */
  el: HTMLElement
  /** The cloned `#output` root. Its direct children are the atomic content blocks. */
  content: HTMLElement
  cleanup: () => void
}

/**
 * Clone the live preview into a fixed-width off-screen host.
 *
 * Capturing a clone rather than the live preview keeps the on-screen editor
 * untouched while the export rewrites scroll containers and drops unresolved
 * async placeholders.
 */
export async function createOffScreenPreview(
  previewDevice: PreviewDevice,
): Promise<OffScreenPreview | null> {
  const publication = await preparePublication('light')
  const output = publication.root
  const useNightPreview = publication.themeMode === 'dark'
  const width = previewDevice === `mobile` ? `375px` : `750px`

  const host = document.createElement(`div`)
  host.setAttribute(`data-png-export-host`, ``)
  host.style.cssText = `position:fixed;left:-99999px;top:0;z-index:-1;visibility:visible;pointer-events:none;`
  try {
    assertPublicationComplete(publication)
    host.innerHTML = await getPngCaptureStyles(publication)

    const wrapper = document.createElement(`div`)
    wrapper.className = useNightPreview ? `output_night` : ``
    wrapper.style.width = width

    const preview = document.createElement(`div`)
    preview.className = `preview border-x shadow-xl mx-auto`
    preview.style.width = width
    preview.style.margin = `0`

    const content = output.cloneNode(true) as HTMLElement
    content.removeAttribute(`id`)
    content.classList.add(PNG_CAPTURE_ROOT_CLASS)
    content.style.width = `100%`
    content.querySelectorAll(`.diagram-download-bar`).forEach(el => el.remove())
    applyExportLayout(content)

    preview.appendChild(content)
    wrapper.appendChild(preview)
    host.appendChild(wrapper)
    document.body.appendChild(host)
    await Promise.all(Array.from(content.querySelectorAll('img[src^="data:"]'), image => (image as HTMLImageElement).decode()))

    return {
      el: preview,
      content,
      title: publication.snapshot.title,
      cleanup: () => { host.remove(); publication.dispose() },
    }
  }
  catch (error) { host.remove(); publication.dispose(); throw error }
}

export function getPngCaptureOptions() {
  return {
    backgroundColor: '#fff',
    skipFonts: true,
    pixelRatio: Math.max(window.devicePixelRatio || 1, 2),
    style: { margin: `0` },
  }
}
