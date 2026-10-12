// @vitest-environment jsdom
import { defaultPerThemeSettings } from '@md/shared/configs'
import { articleDigest } from '@md/shared/utils/private-sync'
import { beforeEach, expect, it, vi } from 'vitest'
import { inspectPrivateDocuments, loadPrivateDocuments, savePrivateDocuments } from './private-document-writes'
import { applyRemote, confirmPending, getLocalDraft, getSyncRecord, preparePending, rebaseLocal, saveLocalArticle, selectArticle } from './private-sync'

const memory = vi.hoisted(() => ({ rows: new Map<string, Map<string, any>>(), fail: '' }))
vi.mock('@/lib/visual/capture-theme', () => ({ captureStoredArticleTheme: async (id: string) => {
  const draft = await (await import('./private-sync')).getLocalDraft(id)
  if (!draft?.theme)
    throw new Error('theme_capture_required')
  return draft.theme
} }))
vi.mock('@/storage/db', () => ({ getDatabase: async () => ({
  get: async (store: string, key: string) => structuredClone(memory.rows.get(store)?.get(key)),
  getAll: async (store: string) => [...(memory.rows.get(store)?.values() ?? [])].map(v => structuredClone(v)),
  transaction: () => {
    const copy = structuredClone(memory.rows)
    let aborted = false
    return {
      abort() { aborted = true },
      get done() {
        if (aborted)
          return Promise.reject(new Error('abort'))
        memory.rows = copy
        return Promise.resolve()
      },
      objectStore: (name: string) => {
        if (!copy.has(name))
          copy.set(name, new Map())
        const rows = copy.get(name)!
        return {
          get: async (key: string) => structuredClone(rows.get(key)),
          getAll: async () => [...rows.values()].map(v => structuredClone(v)),
          put: async (row: any) => {
            if (memory.fail === name)
              throw new DOMException('quota', 'QuotaExceededError')
            rows.set(row.id ?? row.key ?? row.path, structuredClone(row))
          },
          add: async (row: any) => {
            const key = row.id ?? row.key ?? row.path
            if (rows.has(key))
              throw new Error('exists')
            rows.set(key, structuredClone(row))
          },
          delete: async (key: string) => rows.delete(key),
        }
      },
    }
  },
}) }))

const vault = '123:main'
const theme = () => ({ id: 'yanhui', settings: defaultPerThemeSettings(), css: '#output p {color:#333}', codeCss: '', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false })
const post = () => ({ id: 'test-1', title: 'Article', content: 'first', history: [], createDatetime: new Date('2026-10-12'), updateDatetime: new Date('2026-10-12') })
beforeEach(() => { memory.rows.clear(); memory.fail = '' })
async function selected() {
  await saveLocalArticle(post(), theme(), vault, 0)
  await selectArticle(vault, 'test-1', true)
  return (await preparePending(vault, 'test-1'))!
}
it('draftAndDirtyMarkerCommitTogether', async () => {
  memory.fail = 'meta'
  await expect(saveLocalArticle(post(), theme(), vault, 0)).rejects.toThrow()
  expect(memory.rows.get('documents')?.size ?? 0).toBe(0)
  expect(await getLocalDraft('test-1')).toBeNull()
})
it('rejectsStaleLocalGeneration', async () => {
  expect(await saveLocalArticle(post(), theme(), vault, 0)).toBe(1)
  await expect(saveLocalArticle({ ...post(), content: 'stale' }, theme(), vault, 0)).rejects.toThrow('local_conflict')
  expect((await getLocalDraft('test-1'))?.post.content).toBe('first')
})
it('oldAckKeepsNewGenerationPending', async () => {
  const pending = await selected()
  await saveLocalArticle({ ...post(), content: 'new' }, theme(), vault, 1)
  const stored = { article: pending.request.article, revision: pending.request.operationId, operationId: pending.request.operationId, digest: await articleDigest(pending.request.article) }
  await confirmPending(vault, 'test-1', 1, { head: 'a'.repeat(40), stored })
  const next = await preparePending(vault, 'test-1')
  expect(next?.request.article.markdown).toBe('new')
  expect(next?.generation).toBe(2)
  expect(next?.request.baseRevision).toBe(stored.revision)
})
it('styleOnlyEditIsDirty', async () => {
  const first = await selected()
  const changed = theme(); changed.settings.fontSize = '18px'
  await saveLocalArticle(post(), changed, vault, 1)
  expect((await getSyncRecord(vault, 'test-1')).localGeneration).toBe(2)
  expect(await preparePending(vault, 'test-1')).toEqual(first)
})
it('remotePullCannotClobberConcurrentTabEdit', async () => {
  const first = await selected()
  await saveLocalArticle({ ...post(), content: 'new tab' }, theme(), vault, 1)
  const stored = { article: first.request.article, revision: first.request.operationId, operationId: first.request.operationId, digest: await articleDigest(first.request.article) }
  await expect(applyRemote(vault, stored, [], 1)).rejects.toThrow('local_conflict')
  expect((await getLocalDraft('test-1'))?.post.content).toBe('new tab')
})
it('switchVaultDoesNotReuseOldQueue', async () => {
  await selected()
  expect(await preparePending('999:main', 'test-1')).toBeNull()
  expect((await getSyncRecord(vault, 'test-1')).pending).not.toBeNull()
})
it('noUploadBeforeSelectionAndMissingImagesBlockPreparation', async () => {
  await saveLocalArticle({ ...post(), content: `![missing](assets/${'a'.repeat(64)}.png)` }, theme(), vault, 0)
  expect(await preparePending(vault, 'test-1')).toBeNull()
  await selectArticle(vault, 'test-1', true)
  await expect(preparePending(vault, 'test-1')).rejects.toThrow('missing_asset')
})
it('staleWholeListCannotDeleteUnseenDocumentsOrOverwriteOtherTabs', async () => {
  await saveLocalArticle(post(), theme(), vault, 0)
  const rows = await loadPrivateDocuments()
  await saveLocalArticle({ ...post(), content: 'other tab' }, theme(), vault, 1)
  await saveLocalArticle({ ...post(), id: 'other-article' }, theme(), vault, 0)
  await savePrivateDocuments(rows, true)
  expect((await getLocalDraft('test-1'))?.post.content).toBe('other tab')
  expect((await getLocalDraft('other-article'))?.deleted).toBe(false)
  await expect(savePrivateDocuments([{ ...rows[0], content: 'stale edit' }], true)).rejects.toThrow('local_conflict')
})
it('historyBackupIsSavedWithoutPostponingContentSync', async () => {
  await saveLocalArticle(post(), theme(), vault, 0)
  const rows = await loadPrivateDocuments()
  const events: any[] = []
  const onSaved = (event: Event) => events.push((event as CustomEvent).detail)
  window.addEventListener('md:private-saved', onSaved)
  try {
    rows[0].history.unshift({ content: rows[0].content, datetime: '2026-10-12T00:00:00.000Z' })
    await savePrivateDocuments(rows, false)
    expect((await getLocalDraft('test-1'))?.post.history).toHaveLength(1)
    expect(events[events.length - 1]).toMatchObject({ id: 'test-1', historyOnly: true })
    rows[0].content = 'edited body'
    await savePrivateDocuments(rows, false)
    expect(events[events.length - 1]).toMatchObject({ id: 'test-1', historyOnly: false })
  }
  finally { window.removeEventListener('md:private-saved', onSaved) }
})
it('deleteKeepsTheBodyInATombstoneAndImportRemainsUnselected', async () => {
  await saveLocalArticle(post(), theme(), vault, 0)
  await selectArticle(vault, 'test-1', true)
  await saveLocalArticle(post(), theme(), vault, 1, true)
  expect((await preparePending(vault, 'test-1'))?.request.article).toMatchObject({ markdown: 'first', deleted: true })
  expect(memory.rows.get('documents')?.has('test-1')).toBe(false)
  await loadPrivateDocuments()
  await savePrivateDocuments([{ ...post(), id: 'imported' }], false, { assets: [], theme: theme() })
  expect((await getLocalDraft('imported'))?.theme).toMatchObject({ id: 'yanhui' })
  expect(await preparePending(vault, 'imported')).toBeNull()
})
it('inspectingWithoutAcceptingCannotAdvanceTheEditorBaseline', async () => {
  await saveLocalArticle(post(), theme(), vault, 0)
  const rows = await loadPrivateDocuments()
  await saveLocalArticle({ ...post(), content: 'remote replacement' }, theme(), vault, 1)
  await inspectPrivateDocuments()
  await expect(savePrivateDocuments([{ ...rows[0], content: 'unsaved typing' }], false)).rejects.toThrow('local_conflict')
  expect((await getLocalDraft('test-1'))?.post.content).toBe('remote replacement')
})
it('acceptingRemoteAtomicallyPreservesTheLocalVersion', async () => {
  const pending = await selected()
  const article = { ...pending.request.article, markdown: 'remote' }
  const op = crypto.randomUUID()
  const stored = { article, revision: op, operationId: op, digest: await articleDigest(article) }
  await applyRemote(vault, stored, [], 1, true)
  expect((await getLocalDraft('test-1'))?.post.content).toBe('remote')
  const copies = [...memory.rows.get('documents')!.values()].filter(p => p.id !== 'test-1')
  expect(copies).toHaveLength(1)
  expect(copies[0].content).toBe('first')
})
it('rebasingTheLocalChoiceKeepsItsBodyAndUsesANewOperation', async () => {
  const first = await selected()
  const remote = { article: first.request.article, revision: crypto.randomUUID(), operationId: crypto.randomUUID(), digest: 'a'.repeat(64) }
  await rebaseLocal(vault, 'test-1', remote, 1)
  const pending = await preparePending(vault, 'test-1')
  expect(pending?.request.operationId).not.toBe(first.request.operationId)
  expect(pending?.request.baseRevision).toBe(remote.revision)
  expect(pending?.request.article.markdown).toBe('first')
})
