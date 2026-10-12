import { ref } from 'vue'
import { t } from '@/i18n/translate'
import { assetRepo } from '@/storage/repositories/assets'

// Kept for compatibility with existing host-specific cache readers.
export function imageUploadCacheKey(host: string, hash: string): string { return `${host}:${hash}` }

export function useImageUploader() {
  const isUploading = ref(false)
  const error = ref<string | null>(null)
  const upload = async (resource: string | File): Promise<string> => {
    isUploading.value = true
    error.value = null
    try {
      if (typeof resource === 'string') {
        if (!/^https?:\/\//i.test(resource))
          throw new Error('visual.invalidLink')
        return resource
      }
      return (await assetRepo.put(resource)).path
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      error.value = message.startsWith('visual.') || message.startsWith('upload.') ? t(message) : message
      throw new Error(error.value)
    }
    finally { isUploading.value = false }
  }
  return { upload, isUploading, error }
}
