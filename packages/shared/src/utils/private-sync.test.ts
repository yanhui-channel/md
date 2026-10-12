import { describe, expect, it } from 'vitest'
import { defaultPerThemeSettings } from '../configs/style'
import { articleDigest, parsePrivateArticle, parseVaultState } from './private-sync'

function fixture() {
  return {
    id: 'article-1',
    title: 'Test article',
    parentId: null,
    markdown: '# Test',
    theme: { id: 'yanhui', settings: defaultPerThemeSettings(), css: '#output p {color:#333}', codeCss: '', previewWidth: '750px', legend: 'none', citeStatus: false, countStatus: false, indent: false, justify: false },
    assets: [{ path: `assets/${'a'.repeat(64)}.png`, sha256: 'a'.repeat(64), mime: 'image/png', size: 68, blobSha: null }],
    external: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    deleted: false,
  }
}

describe('private sync contracts', () => {
  it('rejectsTraversalAndOversizedAsset', () => {
    const article = fixture()
    const asset = article.assets[0]
    expect(() => parsePrivateArticle({ ...article, id: '../secret' })).toThrow()
    expect(() => parsePrivateArticle({ ...article, assets: [{ ...asset, path: '../secret' }] })).toThrow()
    expect(() => parsePrivateArticle({ ...article, assets: [{ ...asset, size: 10 * 1024 * 1024 + 1 }] })).toThrow()
    expect(() => parsePrivateArticle({ ...article, assets: [asset, asset] })).toThrow()
    expect(() => parsePrivateArticle({ ...article, assets: [{ ...asset, sha256: 'b'.repeat(64) }] })).toThrow()
    expect(() => parseVaultState({ schemaVersion: 2, vaultId: '123:main', head: null, entries: [] })).toThrow()
  })
  it('themeOnlyChangeChangesDigest', async () => {
    const article = parsePrivateArticle(fixture())
    const changed = structuredClone(article)
    changed.theme.settings.fontSize = '20px'
    expect(await articleDigest(changed)).not.toBe(await articleDigest(article))
  })
  it('stableDigestIgnoresObjectKeyOrderAndTransportMetadata', async () => {
    const article = parsePrivateArticle(fixture())
    const changed = { ...article, updatedAt: '2026-10-13T00:00:00.000Z', assets: article.assets.map(asset => ({ ...asset, blobSha: 'b'.repeat(40) })) }
    const reordered = Object.fromEntries(Object.entries(changed).reverse())
    expect(await articleDigest(parsePrivateArticle(reordered))).toBe(await articleDigest(article))
  })
  it('rejectsCredentialsAndUnsafeCssAtTheBoundary', () => {
    const article = fixture()
    expect(() => parsePrivateArticle({ ...article, token: 'secret' })).toThrow()
    expect(() => parsePrivateArticle({ ...article, theme: { ...article.theme, css: '#output {background:url(https://example.invalid/track)}' } })).toThrow()
    expect(() => parsePrivateArticle({ ...article, external: ['javascript:alert(1)'] })).toThrow()
    expect(() => parsePrivateArticle({ ...article, parentId: article.id })).toThrow()
  })
  it('acceptsEmptyVaultAndRejectsDuplicateCatalogEntries', () => {
    expect(parseVaultState({ schemaVersion: 1, vaultId: '123:main', head: null, entries: [] }).entries).toEqual([])
    const row = { id: 'a', title: 'a', parentId: null, revision: '11111111-1111-4111-8111-111111111111', digest: 'a'.repeat(64), updatedAt: '2026-10-12T00:00:00.000Z', deleted: false }
    expect(() => parseVaultState({ schemaVersion: 1, vaultId: '123:main', head: 'a'.repeat(40), entries: [row, row] })).toThrow()
  })
})
