// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { collectImageReferences, rewriteImageReferences } from './assets'

describe('article image references', () => {
  const markdown = '# 保持原文\n\n![a](<pics/a b.png> "标题")\n\n![b][image]\n\n[image]: pics/ref.png "ref"\n\n<div><img src="pics/html.png" alt="图片"></div>\n\n```md\n![not](code.png)\n```\n\n文本 pics/ref.png'
  it('collects ordinary, reference and HTML images but excludes fenced examples', () => {
    expect(collectImageReferences(markdown)).toEqual(['pics/a b.png', 'pics/ref.png', 'pics/html.png'])
  })
  it('only rewrites selected image destinations, preserving prose, title and code', () => {
    const result = rewriteImageReferences(markdown, { 'pics/a b.png': 'assets/a.png', 'pics/ref.png': 'assets/b.png', 'pics/html.png': 'assets/c.png' })
    expect(collectImageReferences(result)).toEqual(['assets/a.png', 'assets/b.png', 'assets/c.png'])
    expect(result).toContain('文本 pics/ref.png')
    expect(result).toContain('![not](code.png)')
    expect(result).toContain('"标题"')
    expect(result).toContain('alt="图片"')
  })
  it('duplicate destinations do not alter identical prose', () => {
    const source = '![a](a.png) ![b](a.png)\n\n`![a](a.png)`'
    expect(rewriteImageReferences(source, { 'a.png': 'assets/new.png' })).toBe('![a](assets/new.png) ![b](assets/new.png)\n\n`![a](a.png)`')
  })
})
