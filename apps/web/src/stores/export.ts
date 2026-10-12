import type { PdfExportOptions } from '@/services/export'
import { sanitizeTitle } from '@md/shared/utils/basicHelpers'
import { downloadFile } from '@md/shared/utils/fileHelpers'
import { t } from '@/i18n/translate'
import { collectImageReferences } from '@/lib/visual/assets'
import { exportArticleBundle } from '@/services/article-bundle'
import {
  DEFAULT_PNG_SEGMENT_HEIGHT,
  downloadMD,
  exportHTML,
  exportPDF,
  exportPNG,
  exportPNGSegments,
  exportPureHTML,
} from '@/services/export'
import { preparePublication } from '@/services/export/publication'
import { LOCAL_ASSET_PATTERN } from '@/storage/repositories/assets'
import { useEditorStore } from './editor'
import { usePostStore } from './post'
import { useUIStore } from './ui'

/** Export helpers: HTML, PDF, Markdown, card image, etc. */
export const useExportStore = defineStore(`export`, () => {
  const postStore = usePostStore()
  const uiStore = useUIStore()

  async function runExport(action: () => Promise<unknown>) {
    try { await action() }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  const exportEditorContent2HTML = async () => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    await runExport(() => exportHTML(currentPost.title))
  }

  const exportEditorContent2PureHTML = (content: string) => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    return runExport(() => exportPureHTML(content, currentPost.title))
  }

  const downloadAsCardImage = async () => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    await runExport(() => exportPNG(currentPost.title, {
      previewDevice: uiStore.previewDevice,
    }))
  }

  const downloadAsSegmentedImages = async (maxSegmentHeight = DEFAULT_PNG_SEGMENT_HEIGHT) => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    const toastId = toast.loading(t(`store.png.segmentsStart`))
    try {
      const count = await exportPNGSegments(currentPost.title, {
        previewDevice: uiStore.previewDevice,
        maxSegmentHeight,
        onProgress: (done, total) => {
          toast.loading(t(`store.png.segmentsProgress`, { done, total }), { id: toastId })
        },
      })

      if (count === 0)
        toast.error(t(`store.png.segmentsEmpty`), { id: toastId })
      else
        toast.success(t(`store.png.segmentsDone`, { count }), { id: toastId })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t(`store.png.segmentsFailed`, { message }), { id: toastId })
    }
  }

  const exportEditorContent2PDF = async (options?: Partial<PdfExportOptions>) => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    await runExport(() => exportPDF(currentPost.title, options))
  }

  const exportEditorContent2MD = async (_content: string) => {
    const currentPost = postStore.currentPost
    if (!currentPost)
      return

    await runExport(async () => {
      const snapshot = useEditorStore().captureMarkdown(currentPost)
      downloadMD(snapshot.markdown, snapshot.title)
      if (collectImageReferences(snapshot.markdown).some(path => LOCAL_ASSET_PATTERN.test(path)))
        toast.info('Markdown 不包含图片文件；跨设备请使用文章备份 ZIP')
    })
  }

  const exportBundle = () => runExport(async () => {
    const publication = await preparePublication()
    try {
      const blob = await exportArticleBundle(publication)
      const url = URL.createObjectURL(blob)
      downloadFile(url, `${sanitizeTitle(publication.snapshot.title)}.zip`)
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      if (publication.external.length || publication.missing.length)
        toast.warning('备份含外链或缺失图片，无法完全离线使用')
    }
    finally { publication.dispose() }
  })

  return {
    exportBundle,
    exportEditorContent2HTML,
    exportEditorContent2PureHTML,
    downloadAsCardImage,
    downloadAsSegmentedImages,
    exportEditorContent2PDF,
    exportEditorContent2MD,
  }
})
