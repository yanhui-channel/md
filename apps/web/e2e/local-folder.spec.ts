import { expect, test } from '@playwright/test'
import { PrivateApi, readRows, start } from './fixtures/private-api'

test('folder handle survives reload, reauthorization and panel close without changing files', async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Directory picker is a Chromium capability')
  const api = new PrivateApi()
  await api.attach(context)
  // Real IndexedDB/OPFS handles, with only the OS picker and permission prompts simulated.
  await context.addInitScript(() => {
    Object.defineProperty(FileSystemHandle.prototype, 'queryPermission', {
      configurable: true,
      value: async () => sessionStorage.getItem('folder-test-permission') ?? 'granted',
    })
    Object.defineProperty(FileSystemHandle.prototype, 'requestPermission', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('folder-test-permission', 'granted')
        return 'granted'
      },
    })
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const folder = await root.getDirectoryHandle('folder-test', { create: true })
      const file = await folder.getFileHandle('sample.md', { create: true })
      const writer = await file.createWritable()
      await writer.write('# Unchanged local file')
      await writer.close()
      return folder
    }
  })
  await page.route('**/folder-test-setup', route => route.fulfill({ contentType: 'text/html', body: '<p>Test setup</p>' }))
  await page.goto(`${api.origin}/folder-test-setup`)
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('doocs-md', 5)
      open.onupgradeneeded = () => {
        const db = open.result
        const docs = db.createObjectStore('documents', { keyPath: 'id' })
        docs.createIndex('updateDatetime', 'updateDatetime')
        docs.createIndex('parentId', 'parentId')
        db.createObjectStore('assets', { keyPath: 'path' })
        for (const name of ['settings', 'secrets', 'cache', 'meta'])
          db.createObjectStore(name, { keyPath: 'key' })
        docs.put({ id: 'existing', title: 'Preserved draft', content: 'keep-me', history: [], createDatetime: '2026-10-20', updateDatetime: '2026-10-20' })
      }
      open.onsuccess = () => { open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
  })
  await start(page)
  expect((await readRows(page, 'documents')).find(row => row.id === 'existing')?.content).toBe('keep-me')
  await page.getByRole('menuitem', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: '本地文件夹', exact: true }).click()
  const panel = page.locator('.folder-source-panel')
  await panel.getByRole('button', { name: '打开文件夹', exact: true }).click()
  await expect(panel.getByText('sample.md', { exact: true })).toBeVisible()
  await page.reload()
  await expect(panel.getByText('sample.md', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '关闭面板', exact: true }).click()
  await page.getByRole('menuitem', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: '本地文件夹', exact: true }).click()
  await expect(panel.getByText('sample.md', { exact: true })).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('folder-test-permission', 'prompt'))
  await page.reload()
  await expect(panel.getByRole('button', { name: '重新连接', exact: true })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('folder-test-permission'))).toBe('prompt')
  await page.screenshot({ path: testInfo.outputPath('folder-reconnect.png'), fullPage: true })
  await panel.getByRole('button', { name: '重新连接', exact: true }).click()
  await expect(panel.getByText('sample.md', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('folder-restored.png'), fullPage: true })
  await panel.getByRole('button', { name: '忘记此文件夹（不删除文件）', exact: true }).click()
  await page.reload()
  await expect(panel.getByText('未打开文件夹', { exact: true })).toBeVisible()
  expect(await readRows(page, 'folders')).toEqual([])
  expect((await readRows(page, 'documents')).find(row => row.id === 'existing')?.content).toBe('keep-me')
  expect(await page.evaluate(async () => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('folder-test')
    return (await (await folder.getFileHandle('sample.md')).getFile()).text()
  })).toBe('# Unchanged local file')
  expect(api.commits).toEqual([])
  expect(api.pageErrors).toEqual([])
})
