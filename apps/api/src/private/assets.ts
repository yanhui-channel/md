import type { PrivateAsset } from '@md/shared/types/private-sync'
import type { PrivateEnv } from './types'
import { gitShaSchema, MAX_SYNC_ASSET, sha256Bytes } from '@md/shared/utils/private-sync'
import { github, repositoryIdentity } from './github'
import { SyncError } from './types'

export async function validateAssetBytes(path: string, bytes: Uint8Array): Promise<Omit<PrivateAsset, 'blobSha'>> {
  if (!bytes.length || bytes.length > MAX_SYNC_ASSET)
    throw new SyncError('asset_size_limit', 413)
  let ext = ''
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    ext = 'png'
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    ext = 'jpg'
  else if (/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6))))
    ext = 'gif'
  else if (/^RIFF....WEBP$/s.test(new TextDecoder().decode(bytes.slice(0, 12))))
    ext = 'webp'
  const sha256 = await sha256Bytes(bytes)
  if (!ext || path !== `assets/${sha256}.${ext}`)
    throw new SyncError('invalid_asset', 422)
  return { path, sha256, size: bytes.length, mime: `image/${ext === 'jpg' ? 'jpeg' : ext}` }
}

export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

export async function readBlob(env: PrivateEnv, sha: string, max: number): Promise<Uint8Array> {
  gitShaSchema.parse(sha)
  const blob = await github<{ sha: string, encoding: string, size: number, content: string }>(env, `/git/blobs/${sha}`)
  if (blob.sha !== sha || blob.encoding !== 'base64' || !Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > max || typeof blob.content !== 'string')
    throw new SyncError('invalid_blob', 422)
  const bytes = Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0))
  if (bytes.length !== blob.size || bytes.length > max)
    throw new SyncError('invalid_blob', 422)
  return bytes
}

export async function storeAsset(env: PrivateEnv, path: string, bytes: ArrayBuffer): Promise<PrivateAsset> {
  const vaultId = await repositoryIdentity(env)
  const asset = await validateAssetBytes(path, new Uint8Array(bytes))
  const result = await github<{ sha: string }>(env, '/git/blobs', 'POST', { encoding: 'base64', content: base64(new Uint8Array(bytes)) })
  const uploaded = { ...asset, blobSha: gitShaSchema.parse(result.sha) }
  const signature = await crypto.subtle.sign('HMAC', await assetKey(env), assetPayload(vaultId, uploaded))
  return { ...uploaded, proof: Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('') }
}

function assetKey(env: PrivateEnv) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function assetPayload(vaultId: string, asset: PrivateAsset) {
  return new TextEncoder().encode(JSON.stringify(['asset-v1', vaultId, asset.path, asset.sha256, asset.mime, asset.size, asset.blobSha]))
}

// The receipt attests a validated blob, not access; repository authorization is still required.
export async function verifyAssetProofs(env: PrivateEnv, vaultId: string, assets: PrivateAsset[]) {
  const key = await assetKey(env)
  for (const asset of assets) {
    if (!asset.blobSha || !asset.proof)
      throw new SyncError('asset_upload_required', 422)
    const signature = Uint8Array.from(asset.proof.match(/../g)!, h => Number.parseInt(h, 16))
    if (!await crypto.subtle.verify('HMAC', key, signature, assetPayload(vaultId, asset)))
      throw new SyncError('asset_upload_required', 422)
  }
}
