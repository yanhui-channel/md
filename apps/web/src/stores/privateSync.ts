import type { HistoryPage, StoredPrivateArticle, VaultState } from '@md/shared/types/private-sync'
import type { PrivateIdentity } from '@/services/private-sync/client'
import type { PrivateSyncStatus } from '@/services/private-sync/coordinator'
import type { PrivateSyncRecord } from '@/storage/repositories/private-sync'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { captureStoredArticleTheme } from '@/lib/visual/capture-theme'
import { PRIVATE_SYNC_ENABLED } from '@/services/account/config'
import { PrivateSyncClient, PrivateSyncError } from '@/services/private-sync/client'
import { createPrivateSyncCoordinator, downloadAssets } from '@/services/private-sync/coordinator'
import { saveBeforeNavigation } from '@/services/private-sync/navigation'
import { getDatabase, getMeta, setMeta } from '@/storage/db'
import { store } from '@/storage/manager'
import { fromStored } from '@/storage/repositories/document-model'
import { documentRepo, isUsingLegacyDocumentStorage } from '@/storage/repositories/documents'
import { inspectPrivateDocuments } from '@/storage/repositories/private-document-writes'
import { applyRemote, getLocalDraft, getSyncRecord, listSyncRecords, rebaseLocal, rememberConflict, saveLocalArticle, selectArticle } from '@/storage/repositories/private-sync'
import { useEditorStore } from './editor'
import { usePostStore } from './post'
import { useThemeStore } from './theme'

export const usePrivateSyncStore = defineStore('privateSync', () => {
  const client = new PrivateSyncClient()
  const identity = ref<PrivateIdentity | null>(null)
  const vault = ref<VaultState | null>(null)
  const changedVault = ref(false)
  const status = ref<PrivateSyncStatus>('local')
  const error = ref('')
  const records = ref<Record<string, PrivateSyncRecord>>({})
  const offline = ref<Record<string, boolean>>({})
  const history = ref<HistoryPage | null>(null)
  const historyId = ref('')
  const paused = ref(false)
  let coordinator: ReturnType<typeof createPrivateSyncCoordinator> | undefined
  let initialized = false
  let savedUi = ''
  const isComposing = () => Boolean(useEditorStore().visualSession?.isComposing() || useEditorStore().editor?.composing)
  const stamp = () => JSON.stringify({ posts: usePostStore().posts, source: useEditorStore().getContent(), theme: useThemeStore().restoredTheme ?? useThemeStore().$state })
  async function save() {
    if (isComposing())
      throw new Error('composition_active')
    if (isUsingLegacyDocumentStorage())
      throw new Error('private_storage_unavailable')
    const editor = useEditorStore()
    editor.flushContentToPostStore()
    await editor.visualSession?.flush()
    await usePostStore().persistImmediately()
    if (isComposing())
      throw new Error('composition_active')
    savedUi = stamp()
  }
  function failed(reason: unknown) {
    status.value = 'attention'
    error.value = reason instanceof PrivateSyncError ? reason.code : reason instanceof Error ? reason.message : 'sync_failed'
    if (['login_required', 'invalid_origin_or_csrf', 'owner_only', 'repository_authorization_required', 'private_writable_repository_required', 'vault_changed'].includes(error.value)) {
      coordinator?.pause()
      paused.value = true
      if (['login_required', 'invalid_origin_or_csrf', 'owner_only'].includes(error.value))
        identity.value = null
    }
  }
  async function refresh() {
    const id = identity.value?.vaultId ?? await getMeta('private:active-vault')
    records.value = id ? Object.fromEntries((await listSyncRecords(id)).map(row => [row.id, row.record])) : {}
    const states: Record<string, boolean> = {}
    const db = await getDatabase()
    for (const [articleId] of Object.entries(records.value)) {
      const draft = await getLocalDraft(articleId)
      if (!draft || draft.deleted || !draft.theme) { states[articleId] = false; continue }
      const { collectImageReferences } = await import('@/lib/visual/assets')
      let complete = true
      for (const path of collectImageReferences(draft.post.content)) {
        if (path.startsWith('assets/') && !await db.get('assets', path))
          complete = false
        else if (!path.startsWith('assets/') && !path.startsWith('data:'))
          complete = false
      }
      states[articleId] = complete
    }
    offline.value = states
  }
  async function reloadView() {
    if (stamp() !== savedUi || isComposing())
      throw new Error('local_conflict')
    const snapshot = await inspectPrivateDocuments()
    for (const post of snapshot.posts) {
      if (post.themeId)
        await store.get(post.themeId)
    }
    if (stamp() !== savedUi || isComposing())
      throw new Error('local_conflict')
    snapshot.accept()
    await usePostStore().acceptPrivatePosts(snapshot.posts)
    savedUi = stamp()
    await refresh()
  }
  function connect() {
    coordinator?.dispose()
    paused.value = false
    coordinator = createPrivateSyncCoordinator(client, {
      vaultId: identity.value!.vaultId,
      beforeSync: save,
      onRemote: reloadView,
      onVault: (value) => { vault.value = value },
      onChange: (next, reason) => {
        if (reason) {
          failed(new Error(reason))
        }
        else { status.value = next; error.value = '' }
        void refresh().catch(failed)
      },
    })
  }
  async function initialize() {
    if (!PRIVATE_SYNC_ENABLED)
      return
    coordinator?.dispose()
    coordinator = undefined
    try {
      if (!initialized) {
        initialized = true
        window.addEventListener('md:private-saved', (event) => {
          coordinator?.notifySaved((event as CustomEvent).detail.id)
          void refresh().catch(failed)
        })
      }
      identity.value = await client.me()
      const previous = await getMeta('private:active-vault')
      changedVault.value = Boolean(previous && previous !== identity.value.vaultId)
      if (changedVault.value) { failed(new Error('vault_changed')); return }
      await setMeta('private:active-vault', identity.value.vaultId)
      vault.value = (await client.readVault()).state
      if (vault.value?.vaultId !== identity.value.vaultId)
        throw new Error('vault_changed')
      connect()
      await refresh()
      coordinator!.notifySaved('')
    }
    catch (reason) { failed(reason) }
  }
  async function acceptVault() {
    if (!identity.value || !changedVault.value)
      return
    await save()
    await setMeta('private:active-vault', identity.value.vaultId)
    await initialize()
  }
  async function login() {
    try { await saveBeforeNavigation(isComposing, save, () => { window.location.assign('/api/auth/github') }) }
    catch (reason) { failed(reason) }
  }
  async function selectArticles(ids: string[]) {
    try {
      await save()
      if (!identity.value || changedVault.value)
        throw new Error('login_required')
      for (const id of ids) {
        const post = usePostStore().getPostById(id)
        if (!post)
          continue
        const theme = await captureStoredArticleTheme(id)
        const key = `private:theme:${id}`
        post.themeId = key
        await documentRepo.savePost(post)
        await store.get(key)
        // The active UI must also be fixed to this article's snapshot.
        if (!theme)
          throw new Error('theme_capture_required')
        await selectArticle(identity.value.vaultId, id, true)
      }
      await refresh()
      coordinator?.notifySaved('')
    }
    catch (reason) { failed(reason) }
  }
  async function unselect(id: string) {
    if (identity.value)
      await selectArticle(identity.value.vaultId, id, false)
    await refresh()
  }
  async function syncNow() {
    try {
      if (!coordinator || paused.value)
        await initialize()
      if (identity.value && !changedVault.value && !paused.value)
        await coordinator?.syncNow()
      await refresh()
    }
    catch (reason) { failed(reason) }
  }
  function pause() { coordinator?.pause(); paused.value = true; status.value = 'local' }
  async function logout() {
    pause()
    try { await save(); await client.logout(); identity.value = null; error.value = 'local_copies_retained' }
    catch (reason) { failed(reason) }
  }
  async function download(id: string) {
    try {
      await save()
      if (!identity.value || changedVault.value)
        throw new Error('login_required')
      const latest = (await client.readVault()).state!
      if (latest.vaultId !== identity.value.vaultId)
        throw new Error('vault_changed')
      vault.value = latest
      const generation = (await getLocalDraft(id))?.generation ?? 0
      const stored = await client.readArticle(id, latest.head!)
      const assets = await downloadAssets(client, stored, latest.head!)
      await save()
      try { await applyRemote(identity.value.vaultId, stored, assets, generation) }
      catch (reason) {
        if (reason instanceof Error && ['local_conflict', 'theme_capture_required'].includes(reason.message))
          await rememberConflict(identity.value.vaultId, id, { head: latest.head!, stored })
        throw reason
      }
      await reloadView()
    }
    catch (reason) { failed(reason); await refresh() }
  }
  async function copyRemote(stored: StoredPrivateArticle, head: string) {
    const assets = await downloadAssets(client, stored, head)
    const id = crypto.randomUUID()
    const a = stored.article
    await saveLocalArticle({ id, title: `${a.title} (remote copy)`, content: a.markdown, history: [], createDatetime: new Date(), updateDatetime: new Date(), parentId: null, themeId: `private:theme:${id}` }, a.theme, 'local', 0, false, assets)
  }
  async function resolveConflict(id: string, action: 'local' | 'remote' | 'copy') {
    pause()
    try {
      await save()
      const vaultId = identity.value!.vaultId
      const record = await getSyncRecord(vaultId, id)
      const local = await getLocalDraft(id)
      let copyId: string | undefined
      if (!record.conflict || !local)
        throw new Error('local_conflict')
      if (action === 'local') {
        if (record.conflict.stored)
          await copyRemote(record.conflict.stored, record.conflict.head)
        await rebaseLocal(vaultId, id, record.conflict.stored, local.generation)
      }
      else {
        if (!record.conflict.stored)
          throw new Error('article_not_found')
        const assets = await downloadAssets(client, record.conflict.stored, record.conflict.head)
        await save()
        copyId = await applyRemote(vaultId, record.conflict.stored, assets, local.generation, true)
      }
      await reloadView()
      if (action === 'copy' && copyId)
        usePostStore().currentPostId = copyId
      connect()
      if (action === 'local')
        await coordinator!.syncNow()
    }
    catch (reason) { failed(reason); await refresh() }
  }
  async function loadHistory(id: string, page = 1) {
    try {
      const next = await client.listHistory(id, page)
      history.value = page === 1 ? next : { ...next, entries: [...(history.value?.entries ?? []), ...next.entries] }
      historyId.value = id
    }
    catch (reason) { failed(reason) }
  }
  async function restoreRevision(id: string, head: string) {
    pause()
    try {
      await save()
      const vaultId = identity.value!.vaultId
      const current = await getLocalDraft(id)
      const stored = await client.readArticle(id, head)
      const assets = await downloadAssets(client, stored, head)
      if (!current)
        throw new Error('download_required')
      const latest = (await client.readVault()).state!
      if (latest.vaultId !== vaultId)
        throw new Error('vault_changed')
      const remote = await client.readArticle(id, latest.head!)
      if (!current.theme)
        throw new Error('theme_capture_required')
      const copyId = crypto.randomUUID()
      await saveLocalArticle({ ...fromStored(current.post), id: copyId, parentId: null, title: `${current.post.title} (local copy)`, themeId: `private:theme:${copyId}` }, current.theme, 'local', 0)
      await saveLocalArticle({ ...fromStored(current.post), title: stored.article.title, content: stored.article.markdown, updateDatetime: new Date(), themeId: `private:theme:${id}:${crypto.randomUUID()}` }, stored.article.theme, vaultId, current.generation, false, assets)
      await rebaseLocal(vaultId, id, remote, current.generation + 1)
      await reloadView()
      connect()
      await coordinator!.syncNow()
    }
    catch (reason) { failed(reason); await refresh() }
  }
  return { identity, vault, changedVault, status, error, records, offline, history, historyId, paused, initialize, acceptVault, login, logout, selectArticles, unselect, syncNow, pause, download, resolveConflict, loadHistory, restoreRevision, save, refresh }
})
