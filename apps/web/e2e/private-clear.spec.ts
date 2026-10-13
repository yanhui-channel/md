import { expect, test } from '@playwright/test'
import { call, edit, PrivateApi, readRows, start, upload } from './fixtures/private-api'

test('localCleanupRequiresConfirmationAndClosedTabsWithoutDeletingRemote', async ({ page, context }) => {
  const api = new PrivateApi(); await api.attach(context); await start(page)
  await edit(page, '# Retained remotely\n\nremote copy'); const id = await upload(page)
  const second = await context.newPage(); await start(second)
  await page.getByRole('button', { name: '私有同步', exact: true }).click()
  await expect(page.getByText('编辑器已可离线打开', { exact: true })).toBeVisible({ timeout: 45000 })
  await page.getByRole('button', { name: '清理本机数据', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect((await readRows(page, 'documents')).some(p => p.id === id)).toBe(true)
  await call(page, 'privateSync', 'pause')
  await page.getByRole('button', { name: '清理本机数据', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByText('请先关闭此站点的其他标签页和主屏幕窗口，再重试。', { exact: true })).toBeVisible()
  expect((await readRows(page, 'documents')).some(p => p.id === id)).toBe(true)
  await second.close()
  await page.getByRole('button', { name: '重试清理', exact: true }).click()
  await expect(page.getByText('本机数据已清理，远端文章未改变。', { exact: true })).toBeVisible()
  expect(api.articles.get(id)?.article.deleted).toBe(false)
  expect((await page.evaluate(() => indexedDB.databases())).some(db => db.name === 'doocs-md')).toBe(false)
})
