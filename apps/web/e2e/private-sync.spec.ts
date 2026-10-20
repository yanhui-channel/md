import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { addImage, call, edit, PrivateApi, readRows, record, start, sync, upload } from './fixtures/private-api'

test('uploadsOnlyExplicitlySelectedArticlesAndPreservesNewEditsDuringUpload', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await sync(page); expect(api.commits).toHaveLength(0)
  await edit(page, '# First\n\none')
  const id = await upload(page)
  expect(api.articles.get(id)?.article.markdown).toContain('one')
  await edit(page, '# First\n\nolder upload')
  let release!: () => void; let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  api.beforeCommit = () => { entered(); return new Promise<void>((resolve) => { release = resolve }) }
  const running = sync(page); await started
  await edit(page, '# First\n\nnewer typing')
  release(); await running
  const pending = await record(page, id)
  expect(pending.localGeneration).toBeGreaterThan(pending.confirmedGeneration)
  await sync(page)
  expect(api.articles.get(id)?.article.markdown).toContain('newer typing')
})
test('twoDevicesPreserveConflictsDeletionAndHistoricalRestore', async ({ browser, page, context, baseURL }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await call(page, 'post', 'addPost', ['Shared'])
  await edit(page, '# Shared\n\nbase'); const id = await upload(page)
  const initialHead = api.head
  const other = await browser.newContext({ baseURL, locale: 'zh-CN' }); await api.attach(other)
  try {
    const phone = await other.newPage(); await start(phone)
    await call(phone, 'privateSync', 'download', [id])
    await phone.evaluate((id) => { (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('post').currentPostId = id }, id)
    await edit(phone, '# Shared\n\nphone edit')
    await edit(page, '# Shared\n\ndesktop edit'); await sync(page); await sync(phone)
    expect((await record(phone, id)).conflict.stored.article.markdown).toContain('desktop edit')
    expect((await readRows(phone, 'documents')).find(p => p.id === id).content).toContain('phone edit')
    await call(phone, 'privateSync', 'resolveConflict', [id, 'remote'])
    expect((await readRows(phone, 'documents')).some(p => p.id !== id && p.content.includes('phone edit'))).toBe(true)
    await edit(page, '# Shared\n\nunsynced desktop')
    await call(phone, 'post', 'delPost', [id]); await sync(phone); await sync(page)
    expect((await record(page, id)).conflict.stored.article.deleted).toBe(true)
    await call(page, 'privateSync', 'resolveConflict', [id, 'local'])
    expect(api.articles.get(id)?.article.markdown).toContain('unsynced desktop')
    expect(api.articles.get(id)?.article.deleted).toBe(false)
    await call(page, 'privateSync', 'restoreRevision', [id, initialHead])
    expect(api.articles.get(id)?.article.markdown).toContain('base')
    expect((await readRows(page, 'documents')).some(p => p.id !== id && p.content.includes('unsynced desktop'))).toBe(true)
  }
  finally { await other.close() }
})
test('themeOnlyChangesSyncAndMissingImageCannotBeConfirmed', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Theme\n\nbody'); const id = await upload(page)
  const before = api.articles.get(id)!.digest
  await page.evaluate(() => { (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('theme').fontSize = '18px' })
  await sync(page)
  expect(api.articles.get(id)!.article.theme.settings.fontSize).toBe('18px')
  expect(api.articles.get(id)!.digest).not.toBe(before)
  const count = api.commits.length
  await edit(page, `# Missing\n\n![missing](assets/${'a'.repeat(64)}.png)`)
  await sync(page)
  expect(api.commits.length).toBe(count)
  expect((await record(page, id)).localGeneration).toBeGreaterThan((await record(page, id)).confirmedGeneration)
})
test('restoredThemeEditsSurviveFastSwitchAndReload', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Article A\n\n```json\n{"test": true}\n```'); const id = await upload(page)
  await page.reload(); await start(page)
  await call(page, 'post', 'addPost', ['Article B'])
  await call(page, 'privateSync', 'save')
  await page.evaluate(async (id) => {
    const p = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia
    const posts = p._s.get('post'); const b = posts.currentPostId
    posts.currentPostId = id
    p._s.get('theme').fontSize = '18px'
    posts.currentPostId = b
    await p._s.get('privateSync').save()
    posts.currentPostId = id
  }, id)
  await sync(page)
  expect(api.articles.get(id)!.article.theme.settings.fontSize).toBe('18px')
  await call(page, 'cssEditor', 'addCssContentTab', ['Article override', '#output p { color: #008080 }'])
  await page.evaluate(async () => {
    const theme = (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('theme')
    theme.codeBlockTheme = '/static/libs/highlight/styles/github.css'
    await theme.updateCodeTheme()
  })
  await sync(page)
  expect(api.articles.get(id)!.article.theme.customCss).toMatch(/#008080|rgb\(0,\s*128,\s*128\)/)
  expect(api.articles.get(id)!.article.theme.codeCss).toMatch(/#24292e|rgb\(36,\s*41,\s*46\)/)
  await page.reload(); await start(page)
  const theme = await page.evaluate(() => (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('theme').restoredTheme)
  expect(theme.customCss).toMatch(/#008080|rgb\(0,\s*128,\s*128\)/)
  expect(theme.codeCss).toMatch(/#24292e|rgb\(36,\s*41,\s*46\)/)
  expect(theme.settings.fontSize).toBe('18px')
})
test('quotaBlocksLoginAndKeepsTypedContent', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Saved\n\noriginal')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'documents' || this.name === 'meta')
        throw new DOMException('quota', 'QuotaExceededError')
      return original.apply(this, args as [any])
    }
  })
  await call(page, 'editor', 'importContent', ['# Saved\n\nnot lost on failed save'])
  await call(page, 'privateSync', 'login')
  expect(new URL(page.url()).pathname).toBe('/')
  expect(await call(page, 'editor', 'getContent')).toContain('not lost on failed save')
  expect((await readRows(page, 'documents')).some(p => p.content.includes('original'))).toBe(true)
})
test('sameDeviceStaleTabCannotOverwriteNewerLocalContent', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Shared\n\nbase'); const id = await upload(page)
  const second = await context.newPage(); await start(second)
  await edit(page, '# Shared\n\nnew first tab')
  await call(second, 'editor', 'importContent', ['# Shared\n\nstale second tab'])
  await expect(call(second, 'privateSync', 'save')).rejects.toThrow('local_conflict')
  expect((await readRows(page, 'documents')).find(p => p.id === id).content).toContain('new first tab')
  expect(await call(second, 'editor', 'getContent')).toContain('stale second tab')
  await second.close()
})
test('repositoryChangeAndExpiredLoginNeverUploadToAnotherVault', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Vault\n\nbase'); const id = await upload(page)
  await edit(page, '# Vault\n\nprivate pending')
  const count = api.commits.length
  api.vaultId = '999:other'; await call(page, 'privateSync', 'initialize'); await sync(page)
  expect(api.commits.length).toBe(count)
  expect((await readRows(page, 'documents')).find(p => p.id === id).content).toContain('private pending')
  api.vaultId = '123:main'; api.authorized = false; await call(page, 'privateSync', 'initialize')
  await page.getByRole('button', { name: '私有同步', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录 GitHub', exact: true })).toBeVisible()
  api.authorized = true; await sync(page)
  expect(api.articles.get(id)?.article.markdown).toContain('private pending')
})
test('zipRestoreAndHtmlKeepHeadingCodeAndImageStyle', async ({ page, context }, testInfo) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Export\n\n## Section\n\n```json\n{"ready": true}\n```\n\nend')
  await addImage(page)
  const id = await upload(page)
  expect(api.articles.get(id)?.article.assets).toHaveLength(1)
  const htmlDownload = page.waitForEvent('download')
  await call(page, 'export', 'exportEditorContent2HTML')
  const html = await readFile(await (await htmlDownload).path(), 'utf8')
  expect(html).toContain('Export'); expect(html).toContain('hljs-'); expect(html).toContain('data:image/png;base64,'); expect(html).toContain('160')
  expect(html).not.toContain('contenteditable')
  const zipDownload = page.waitForEvent('download'); await call(page, 'export', 'exportBundle')
  const zip = await zipDownload
  const before = (await readRows(page, 'documents')).length
  await page.locator('[data-bundle-input]').first().setInputFiles(await zip.path())
  await expect.poll(async () => (await readRows(page, 'documents')).length).toBe(before + 1)
  await expect(page.locator('.visual-source-block[data-kind="code"] .hljs-attr')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 844, height: 390 })
  await page.screenshot({ path: testInfo.outputPath('landscape.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(api.externalRequests).toEqual([])
  expect(api.pageErrors).toEqual([])
})
test('independentArticlesSurviveDeviceWritesAndLegacyDatabaseUpgrade', async ({ page, context, browser, baseURL }) => {
  const api = new PrivateApi(); await api.attach(context)
  await context.route('**/legacy-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body>fixture</body></html>' }))
  await page.goto(`${api.origin}/legacy-fixture`)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('doocs-md', 4)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of ['documents', 'settings', 'secrets', 'cache', 'meta']) db.createObjectStore(store, { keyPath: store === 'documents' ? 'id' : 'key' })
      request.transaction!.objectStore('documents').put({ id: 'legacy-1', title: 'Legacy', content: '# Legacy\n\nold database text', history: [], createDatetime: new Date().toISOString(), updateDatetime: new Date().toISOString() })
    }
    request.onsuccess = () => { request.result.close(); resolve() }; request.onerror = () => reject(request.error)
  }))
  await start(page)
  expect((await readRows(page, 'documents')).some(row => row.content.includes('old database text'))).toBe(true)
  await call(page, 'post', 'addPost', ['First device']); await edit(page, '# First device\n\nindependent A'); const a = await upload(page)
  const other = await browser.newContext({ baseURL, locale: 'zh-CN' }); await api.attach(other)
  try {
    const phone = await other.newPage(); await start(phone)
    await call(phone, 'post', 'addPost', ['Second device']); await edit(phone, '# Second device\n\nindependent B'); const b = await upload(phone)
    expect(api.articles.get(a)?.article.markdown).toContain('independent A')
    expect(api.articles.get(b)?.article.markdown).toContain('independent B')
    expect(a).not.toBe(b)
  }
  finally { await other.close() }
})
test('compositionNeverForcesSyncOrLoginNavigation', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# IME\n\nbase'); await upload(page)
  const count = api.commits.length
  await page.locator('.visual-editor .tiptap').dispatchEvent('compositionstart')
  await call(page, 'privateSync', 'syncNow')
  expect(api.commits.length).toBe(count)
  await page.evaluate(() => { void (document.querySelector('#app') as any).__vue_app__.config.globalProperties.$pinia._s.get('privateSync').login() })
  await page.waitForTimeout(150)
  expect(new URL(page.url()).pathname).toBe('/')
  await page.locator('.visual-editor .tiptap').dispatchEvent('compositionend')
  await page.waitForURL('**/api/auth/github')
})
