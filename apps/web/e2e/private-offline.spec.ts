import { expect, test } from '@playwright/test'
import { addImage, call, edit, PrivateApi, start, upload } from './fixtures/private-api'

test('savedArticleSurvivesOfflineReloadWithLocalMathAndNoApiCache', async ({ page, context }, testInfo) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Offline\n\noffline-marker-123\n\n$$\nx^2\n$$\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```json\n{"offline": true}\n```')
  await addImage(page)
  await upload(page)
  await page.getByRole('button', { name: '私有同步', exact: true }).click()
  await expect(page.getByText('编辑器已可离线打开', { exact: true })).toBeVisible({ timeout: 45000 })
  await page.screenshot({ path: testInfo.outputPath('sync-panel.png'), fullPage: true })
  const urls = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
    }
    return urls
  })
  expect(urls.some(url => /\/api\//.test(url))).toBe(false)
  await context.setOffline(true); await page.reload()
  await expect(page.locator('#app-initial-loader')).toHaveCount(0)
  await expect(page.locator('.visual-editor .tiptap')).toContainText('offline-marker-123')
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  await expect(page.locator('.visual-source-block[data-kind="math"] svg').first()).toBeVisible()
  await expect(page.locator('.visual-source-block[data-kind="mermaid"] svg').first()).toBeVisible()
  await expect(page.locator('.visual-source-block .hljs-attr').first()).toBeVisible()
  await expect.poll(() => page.locator('.visual-image img').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await edit(page, '# Offline\n\noffline-marker-456')
  await page.reload(); await expect(page.locator('.visual-editor .tiptap')).toContainText('offline-marker-456')
  await context.setOffline(false)
  await call(page, 'privateSync', 'syncNow')
  expect([...api.articles.values()].some(a => a.article.markdown.includes('offline-marker-456'))).toBe(true)
  expect(api.externalRequests).toEqual([])
  expect(api.pageErrors).toEqual([])
})

test('editorUpdateWaitsForCompositionAndLeavesOtherTabUnchanged', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Update\n\nfirst tab'); await upload(page)
  const second = await context.newPage(); await start(second)
  let otherNavigations = 0
  second.on('framenavigated', (frame) => {
    if (frame === second.mainFrame())
      otherNavigations++
  })
  await page.getByRole('button', { name: '私有同步', exact: true }).click()
  await expect(page.getByText('编辑器已可离线打开', { exact: true })).toBeVisible({ timeout: 45000 })
  api.workerVersion = 1
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
  await expect(page.getByRole('button', { name: '更新编辑器', exact: true })).toBeVisible({ timeout: 45000 })
  await page.locator('.visual-editor .tiptap').dispatchEvent('compositionstart')
  let navigations = 0
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame())
      navigations++
  })
  await page.getByRole('button', { name: '更新编辑器', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await page.waitForTimeout(150)
  expect(navigations).toBe(0)
  await page.locator('.visual-editor .tiptap').dispatchEvent('compositionend')
  await expect.poll(() => navigations).toBe(1)
  await expect(page.locator('.visual-editor .tiptap')).toContainText('first tab')
  expect(otherNavigations).toBe(0)
  await expect(second.locator('.visual-editor .tiptap')).toContainText('first tab')
  expect(await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('yanhui-private-shell-')).length)).toBe(2)
  await second.close()
})
