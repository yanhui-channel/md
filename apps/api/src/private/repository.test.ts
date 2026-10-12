import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitArticle, listArticleHistory, readArticle, readVault } from './repository'
import { GitFixture, testArticle, testEnv } from './test-fixtures'

let git: GitFixture
beforeEach(() => { git = new GitFixture(); vi.stubGlobal('fetch', git.fetch) })
afterEach(() => vi.unstubAllGlobals())
const request = (id = 'article-1') => ({ baseRevision: null, operationId: crypto.randomUUID(), article: testArticle(id) })

describe('atomic private Git repository', () => {
  it('roundTripsBodyThemeCatalogAndFixedRevision', async () => {
    const result = await commitArticle(testEnv, request())
    expect((await readVault(testEnv)).entries[0].title).toBe('Test article')
    expect(await readArticle(testEnv, 'article-1', result.head)).toEqual(result.stored)
    expect(git.text('articles/article-1/article.md')).toBe('# Test')
    expect(git.text('articles/article-1/meta.json')).not.toContain('"markdown"')
    expect(git.forceUpdates).toBe(0)
  })
  it('sameArticleRaceKeepsBothVersions', async () => {
    const a = request(); const b = request()
    b.article.markdown = 'other device'
    git.beforeUpdate = async () => { await commitArticle(testEnv, b) }
    await expect(commitArticle(testEnv, a)).rejects.toMatchObject({ status: 409 })
    expect(git.text('articles/article-1/article.md')).toBe('other device')
    expect(a.article.markdown).toBe('# Test')
  })
  it('unrelatedArticleRaceRebuildsTree', async () => {
    git.beforeUpdate = async () => { await commitArticle(testEnv, request('article-2')) }
    await commitArticle(testEnv, request())
    expect((await readVault(testEnv)).entries.map(e => e.id).sort()).toEqual(['article-1', 'article-2'])
  })
  it('lostAckRetryDoesNotDuplicateCommit', async () => {
    const input = request()
    const result = await commitArticle(testEnv, input)
    expect(await commitArticle(testEnv, input)).toEqual(result)
    expect(git.createdCommits).toHaveLength(1)
    await expect(commitArticle(testEnv, { ...input, article: { ...input.article, markdown: 'changed' } })).rejects.toMatchObject({ status: 409 })
  })
  it('manualMarkdownEditIsNotOverwritten', async () => {
    const result = await commitArticle(testEnv, request())
    git.edit('articles/article-1/article.md', 'manual edit')
    await expect(commitArticle(testEnv, { ...request(), baseRevision: result.stored.revision })).rejects.toMatchObject({ status: 422 })
    expect(git.text('articles/article-1/article.md')).toBe('manual edit')
  })
  it('failsClosedWhenRepoBecomesPublic', async () => {
    git.private = false
    await expect(commitArticle(testEnv, request())).rejects.toMatchObject({ status: 403 })
    await expect(readVault(testEnv)).rejects.toMatchObject({ status: 403 })
    expect(git.createdCommits).toHaveLength(0)
  })
  it('deleteAndRestoreAreNewVersionsWithHistory', async () => {
    const first = await commitArticle(testEnv, request())
    const deleted = await commitArticle(testEnv, { baseRevision: first.stored.revision, operationId: crypto.randomUUID(), article: { ...first.stored.article, deleted: true } })
    expect((await readVault(testEnv)).entries[0].deleted).toBe(true)
    await commitArticle(testEnv, { baseRevision: deleted.stored.revision, operationId: crypto.randomUUID(), article: first.stored.article })
    expect((await listArticleHistory(testEnv, 'article-1', 1)).entries).toHaveLength(3)
    expect((await readArticle(testEnv, 'article-1', deleted.head)).article.deleted).toBe(true)
  })
  it('emptyRepoRequiresInitializationWithoutTreatingEvery404AsEmpty', async () => {
    git.head = ''
    await expect(readVault(testEnv)).rejects.toMatchObject({ code: 'repository_initialization_required' })
  })
  it('listsAFullHistoryPageWithinTheFreeWorkerRequestBudget', async () => {
    let revision: string | null = null
    for (let i = 0; i < 20; i++) {
      const next = request()
      next.article.markdown = String(i)
      const result = await commitArticle(testEnv, { ...next, baseRevision: revision })
      revision = result.stored.revision
    }
    const requests = vi.fn(git.fetch)
    vi.stubGlobal('fetch', requests)
    expect((await listArticleHistory(testEnv, 'article-1', 1)).entries).toHaveLength(20)
    expect(requests.mock.calls.length).toBeLessThan(10)
  })
  it('keepsRateLimitErrorsRecoverableInsteadOfReportingCorruptData', async () => {
    await commitArticle(testEnv, request())
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => String(url).includes('/git/blobs/')
      ? Response.json({}, { status: 429, headers: { 'Retry-After': '120' } })
      : git.fetch(url, init))
    await expect(readVault(testEnv)).rejects.toMatchObject({ code: 'rate_limited', retryAfter: '120' })
  })
})
