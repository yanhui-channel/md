import { validateImageFile } from '@/lib/upload/validate-image'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { getDatabase } from '@/storage/db'
import { STORE_ASSETS } from '@/storage/keys'
import { isUsingLegacyDocumentStorage } from './documents'

export interface StoredAsset { path: string, sha256: string, mime: string, size: number, blob: Blob }
export type AssetRecord = StoredAsset | (Omit<StoredAsset, 'blob'> & { bytes: ArrayBuffer })
export async function assetRecord(asset: StoredAsset): Promise<AssetRecord> {
  if (!PRIVATE_SYNC_ENABLED)
    return asset
  const { blob, ...meta } = asset
  // WebKit ephemeral storage can reject Blob writes; keep legacy Blob reads compatible.
  return { ...meta, bytes: await blob.arrayBuffer() }
}
export const MAX_ASSET_SIZE = 10 * 1024 * 1024
export const LOCAL_ASSET_PATTERN = /^assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/

export async function sha256(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function validateAsset(file: File): Promise<StoredAsset> {
  const check = validateImageFile(file, key => key)
  if (!check.ok || !file.size)
    throw new Error(check.ok ? 'visual.invalidImage' : check.msg)
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  let ext: string
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
    ext = 'png'
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    ext = 'jpg'
  else if (/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6))))
    ext = 'gif'
  else if (/^RIFF....WEBP$/s.test(new TextDecoder().decode(bytes)))
    ext = 'webp'
  else throw new Error('visual.invalidImage')
  const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`
  const blob = new Blob([file], { type: mime })
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const valid = bitmap.width > 0 && bitmap.height > 0
    bitmap.close()
    if (!valid)
      throw new Error('visual.invalidImage')
  }
  else {
    const url = URL.createObjectURL(blob)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!image.naturalWidth)
        throw new Error('visual.invalidImage')
    }
    finally { URL.revokeObjectURL(url) }
  }
  const digest = await sha256(blob)
  return { path: `assets/${digest}.${ext}`, sha256: digest, mime, size: blob.size, blob }
}

export const assetRepo = {
  async put(file: File): Promise<StoredAsset> {
    if (isUsingLegacyDocumentStorage())
      throw new Error('visual.localStorageUnavailable')
    const asset = await validateAsset(file)
    const db = await getDatabase()
    await db.put(STORE_ASSETS, await assetRecord(asset))
    return asset
  },
  async get(path: string): Promise<StoredAsset | undefined> {
    if (!LOCAL_ASSET_PATTERN.test(path))
      return undefined
    const record = await (await getDatabase()).get(STORE_ASSETS, path)
    if (!record || 'blob' in record)
      return record
    const { bytes, ...meta } = record
    return { ...meta, blob: new Blob([bytes], { type: meta.mime }) }
  },
}
