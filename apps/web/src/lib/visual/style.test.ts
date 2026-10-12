// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeVisualHtml } from './style'

describe('visual import style boundary', () => {
  it('keeps typography and table column widths', () => {
    const dom = document.createElement('div')
    dom.innerHTML = sanitizeVisualHtml('<p data-visual="1" style="text-align:center;line-height:2.2;margin-bottom:24px"><span style="font-size:20px;color:#4285f4">文字</span></p><table><tbody><tr><td colwidth="180">数据</td></tr></tbody></table>')
    expect(dom.querySelector('p')?.style.lineHeight).toBe('2.2')
    expect(dom.querySelector('span')?.style.fontSize).toBe('20px')
    expect(dom.querySelector('td')?.getAttribute('colwidth')).toBe('180')
  })
  it('rejects scripts, event handlers, remote CSS and layout escape', () => {
    const dom = document.createElement('div')
    dom.innerHTML = sanitizeVisualHtml('<p style="position:fixed;inset:0;background:url(https://tracker.example/x);font-size:999px" onclick="alert(1)">正文</p><style>@import "https://tracker.example/x";</style><img src="javascript:alert(1)" onerror="alert(1)"><script>alert(1)</script>')
    expect(dom.textContent).toContain('正文')
    expect(dom.querySelector('script,style,[onclick],[onerror],[src^="javascript:"]')).toBeNull()
    expect(dom.innerHTML).not.toMatch(/position:|url\(|999px/)
  })
})
