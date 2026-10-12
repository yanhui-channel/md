import type { StoredPrivateArticle, VaultState } from '@md/shared/types/private-sync'
import type { PrivateSyncClient } from './client'
import type { StoredAsset } from '@/storage/repositories/assets'
import { parseStoredArticle } from '@md/shared/utils/private-sync'
import { getMeta, setMeta } from '@/storage/db'
import { assetRepo, validateAsset } from '@/storage/repositories/assets'
import { applyRemote, confirmPending, getLocalDraft, getSyncRecord, listSyncRecords, preparePending, rememberConflict } from '@/storage/repositories/private-sync'
import { PrivateSyncError } from './client'

export type PrivateSyncStatus = 'local' | 'syncing' | 'synced' | 'attention'
interface Options {
  vaultId: string
  beforeSync: () => Promise<void>
  onRemote: () => Promise<void>
  onVault: (vault: VaultState) => void
  onChange: (status: PrivateSyncStatus, error: string) => void
}
export async function downloadAssets(client: PrivateSyncClient, stored: StoredPrivateArticle, head: string): Promise<StoredAsset[]> {
  const assets: StoredAsset[] = []
  for (const meta of stored.article.assets) {
    const cached = await assetRepo.get(meta.path)
    const blob = cached?.blob ?? new Blob([await client.readAsset(meta.path, head)], { type: meta.mime })
    const checked = await validateAsset(new File([blob], meta.path, { type: meta.mime }))
    if (checked.path !== meta.path || checked.size !== meta.size || checked.mime !== meta.mime)
      throw new PrivateSyncError('invalid_asset')
    assets.push(checked)
  }
  return assets
}
export function createPrivateSyncCoordinator(client: PrivateSyncClient, options: Options) {
  const scheduleKey = `private:schedule:${options.vaultId}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let paused = false
  let disposed = false
  let running = false
  let failures = 0
  const canAuto = () => !!navigator.locks && !paused && !disposed && document.visibilityState === 'visible' && navigator.onLine
  function schedule(delay: number) {
    clearTimeout(timer)
    if (canAuto())
      timer = setTimeout(() => { void run(false) }, delay)
  }
  function notifySaved(_id: string) {
    if (paused || disposed)
      return
    options.onChange('local', ''); schedule(30_000)
  }
  async function execute(manual: boolean) {
    if (paused || disposed)
      return
    const timing = JSON.parse(await getMeta(scheduleKey) ?? '{}') as { lastAutoAt?: number, retryAt?: number }
    const until = Math.max(timing.retryAt ?? 0, !manual && timing.lastAutoAt !== undefined ? timing.lastAutoAt + 60_000 : 0)
    if (until > Date.now()) { schedule(until - Date.now()); return }
    options.onChange('syncing', '')
    await options.beforeSync()
    if (paused || disposed)
      return
    const initial = (await client.readVault()).state
    if (!initial || initial.vaultId !== options.vaultId)
      throw new PrivateSyncError('vault_changed')
    options.onVault(initial)
    let commits = 0
    for (const { id, record } of await listSyncRecords(options.vaultId)) {
      if (paused || disposed)
        return
      if (!record.selected || record.conflict)
        continue
      const pending = await preparePending(options.vaultId, id)
      if (!pending)
        continue
      const request = structuredClone(pending.request)
      for (let i = 0; i < request.article.assets.length; i++) {
        const asset = request.article.assets[i]
        const local = await assetRepo.get(asset.path)
        if (!local)
          throw new PrivateSyncError('missing_asset')
        request.article.assets[i] = await client.uploadAsset(asset, local.blob)
      }
      if (paused || disposed)
        return
      if (!manual)
        await setMeta(scheduleKey, JSON.stringify({ ...timing, lastAutoAt: Date.now() }))
      try {
        const result = await client.commitArticle(request)
        await confirmPending(options.vaultId, id, pending.generation, result)
        commits++
      }
      catch (error) {
        if (error instanceof PrivateSyncError && error.code === 'article_conflict') {
          const conflict = error.detail as { head: string, stored: unknown }
          const stored = conflict.stored ? parseStoredArticle(conflict.stored) : null
          await rememberConflict(options.vaultId, id, { head: conflict.head, stored })
        }
        throw error
      }
      if (!manual)
        break
    }
    const vault = commits ? (await client.readVault()).state! : initial
    if (vault.vaultId !== options.vaultId)
      throw new PrivateSyncError('vault_changed')
    options.onVault(vault)
    for (const entry of vault.entries) {
      if (paused || disposed)
        return
      const record = await getSyncRecord(options.vaultId, entry.id)
      if (!record.selected || record.conflict || record.baseRevision === entry.revision)
        continue
      const local = await getLocalDraft(entry.id)
      const stored = await client.readArticle(entry.id, vault.head!)
      if (record.pending || (local && local.generation !== record.confirmedGeneration)) {
        await rememberConflict(options.vaultId, entry.id, { head: vault.head!, stored })
        continue
      }
      const assets = await downloadAssets(client, stored, vault.head!)
      await options.beforeSync()
      if (paused || disposed)
        return
      await applyRemote(options.vaultId, stored, assets, local?.generation ?? 0)
      await options.onRemote()
    }
    failures = 0
    const records = (await listSyncRecords(options.vaultId)).filter(r => r.record.selected)
    const conflict = records.some(r => r.record.conflict)
    const dirty = records.some(r => r.record.pending || r.record.localGeneration !== r.record.confirmedGeneration)
    options.onChange(conflict ? 'attention' : dirty || !records.length ? 'local' : 'synced', conflict ? 'article_conflict' : '')
    if (dirty && !conflict)
      schedule(60_000)
  }
  async function run(manual: boolean) {
    if (running || paused || disposed || (!manual && !canAuto()))
      return
    running = true
    try {
      if (navigator.locks) {
        await navigator.locks.request(`private-sync:${options.vaultId}`, { ifAvailable: true }, async (lock) => {
          if (!lock) { schedule(5000); return }
          await execute(manual)
        })
      }
      else if (manual) {
        await execute(true)
      }
    }
    catch (error) {
      const code = error instanceof PrivateSyncError ? error.code : error instanceof Error ? error.message : 'sync_failed'
      options.onChange('attention', code)
      if ((error instanceof PrivateSyncError && [401, 403].includes(error.status)) || ['vault_changed'].includes(code)) {
        paused = true
      }
      else if (!(error instanceof PrivateSyncError && [413, 422].includes(error.status) && code !== 'asset_upload_required')
        && !['article_conflict', 'local_conflict', 'missing_asset', 'theme_capture_required', 'invalid_asset', 'article_integrity_failed', 'invalid_catalog', 'asset_size_limit'].includes(code)) {
        const delay = Math.max([5000, 15000, 60000, 300000][Math.min(failures++, 3)], error instanceof PrivateSyncError ? error.retryAfter : 0)
        const current = JSON.parse(await getMeta(scheduleKey) ?? '{}')
        await setMeta(scheduleKey, JSON.stringify({ ...current, retryAt: Date.now() + delay }))
        schedule(delay)
      }
    }
    finally { running = false }
  }
  const foreground = () => {
    if (canAuto())
      schedule(30_000)
  }
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('online', foreground)
  function pause() { paused = true; clearTimeout(timer) }
  function dispose() { disposed = true; pause(); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', foreground) }
  return { notifySaved, syncNow: () => run(true), pause, dispose }
}
