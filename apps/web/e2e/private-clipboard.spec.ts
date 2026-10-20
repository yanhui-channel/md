import { expect, test } from '@playwright/test'
import { call, edit, PrivateApi, start } from './fixtures/private-api'

test('copiedBrandListsKeepNumbersBesideTextWithoutEditorStyles', async ({ page, context }, testInfo) => {
  const api = new PrivateApi()
  await api.attach(context)
  await start(page)
  const markdown = '# 列表复制验证\n\n## 市场、投资与货币\n\n6. 财富应按**全球购买力**衡量。投资的目标是长期保有并扩大自己的实际购买力份额。\n\n7. 保持长期判断，保留[参考链接](https://example.com)。\n\n8. 第三个要点。\n\n9. 第四个要点。\n\n10. 跨过两位数，编号继续保持。\n\n- 嵌套列表\n  1. 内层内容\n  2. 另一条内容\n\n## 第二节\n\n正文。\n\n## 第三节\n\n正文。\n\n## 全球秩序\n\n正文。\n\n## 能力、职业与人生\n\n正文。\n\n### 子标题\n\n保留子标题层级。'
  await edit(page, markdown)
  const before = await call(page, 'editor', 'getContent')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          (window as any).copiedHtml = await (await items[0].getType('text/html')).text()
        },
      },
    })
  })
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).copiedHtml), { timeout: 60000 }).toBeTruthy()
  const html = await page.evaluate(() => (window as any).copiedHtml as string)
  expect(await call(page, 'editor', 'getContent')).toBe(before)

  const pasted = await context.newPage()
  await pasted.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:24px;font-family:sans-serif;font-size:16px;line-height:2">${html}</body></html>`)
  expect(await pasted.locator('ol, ul, li').count()).toBe(0)
  const markers = pasted.locator('.yh-list-marker')
  expect((await markers.allTextContents()).map(text => text.trim())).toEqual(['6.', '7.', '8.', '9.', '10.', '•', '1.', '2.'])
  const { positions, accents } = await markers.evaluateAll((elements) => {
    const lines = [...document.querySelectorAll<HTMLElement>('.yh-heading-line')]
    // Pasting must not depend on the editor's stylesheet or its class selectors.
    document.querySelectorAll('style, span:empty').forEach(element => element.remove())
    document.querySelectorAll('[class]').forEach(element => element.removeAttribute('class'))
    const positions = elements.map((marker) => {
      const paragraph = marker.parentElement!
      const body = document.createRange()
      body.setStartAfter(marker)
      body.setEndAfter(paragraph.lastChild!)
      return {
        tag: paragraph.tagName,
        marker: marker.getBoundingClientRect().top,
        body: body.getClientRects()[0]?.top,
        color: getComputedStyle(marker).color,
      }
    })
    const accents = lines.filter(line => line.isConnected).map((line) => {
      const heading = line.previousElementSibling as HTMLElement
      const rect = line.getBoundingClientRect()
      return {
        tag: line.tagName,
        heading: heading.tagName,
        color: getComputedStyle(line).borderTopColor,
        width: rect.width,
        height: rect.height,
        offset: rect.left - heading.getBoundingClientRect().left - Number.parseFloat(getComputedStyle(heading).paddingLeft),
        gap: rect.top - heading.getBoundingClientRect().bottom,
      }
    })
    return { positions, accents }
  })
  for (const position of positions) {
    expect(position.tag).toBe('P')
    expect(Math.abs(position.marker - position.body)).toBeLessThan(8)
  }
  expect(positions.slice(0, 4).map(position => position.color)).toEqual(['rgb(66, 133, 244)', 'rgb(40, 134, 75)', 'rgb(157, 112, 0)', 'rgb(211, 67, 54)'])
  expect(accents).toHaveLength(5)
  expect(accents.map(accent => accent.color)).toEqual(['rgb(66, 133, 244)', 'rgb(40, 134, 75)', 'rgb(157, 112, 0)', 'rgb(211, 67, 54)', 'rgb(66, 133, 244)'])
  for (const accent of accents) {
    expect(accent.tag).toBe('P')
    expect(accent.heading).toBe('H2')
    expect(accent.width).toBe(42)
    expect(accent.height).toBe(2)
    expect(Math.abs(accent.offset)).toBeLessThan(1)
    expect(accent.gap).toBe(12)
  }
  await expect(pasted.locator('strong')).toHaveText('全球购买力')
  await expect(pasted.locator('a[href="https://example.com"]')).toHaveText('参考链接')
  expect(await pasted.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await pasted.screenshot({ path: testInfo.outputPath('clipboard-list.png'), fullPage: true })
  await pasted.close()
  expect(api.pageErrors).toEqual([])
  expect(api.externalRequests).toEqual([])
})
