import type { ThemeSnapshot } from '@md/shared/utils/article-theme'
import { generateCSSVariables, processCSS, wrapCSSWithScope } from '@md/core/theme'
import { assertNoCssResources, themeSchema } from '@md/shared/utils/article-theme'

export type { ThemeSnapshot } from '@md/shared/utils/article-theme'

export function validateArticleCss(css: string, code = false): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Reject resource loads and escapes before the browser parses an inert sheet.
  assertNoCssResources(css)
  const style = document.createElement('style')
  style.media = 'not all'
  style.textContent = css
  document.head.append(style)
  try {
    function rules(list: CSSRuleList): string {
      return Array.from(list, (rule) => {
        if (rule.type === CSSRule.MEDIA_RULE) {
          const media = rule as CSSMediaRule
          return `@media ${media.conditionText} {${rules(media.cssRules)}}`
        }
        if (rule.type !== CSSRule.STYLE_RULE)
          throw new Error('Unsupported article CSS rule')
        const row = rule as CSSStyleRule
        const selectors = row.selectorText.split(',').map(selector => selector.trim())
        for (let i = 0; i < selectors.length; i++) {
          const selector = selectors[i]
          if (/[+~]/.test(selector.replace(/:nth-(?:child|last-child|of-type|last-of-type)\([\dn\s+-]+\)/g, '')))
            throw new Error('Unscoped article CSS')
          if (selector === ':root') {
            if (Array.from(row.style).some(name => !name.startsWith('--')))
              throw new Error('Global article CSS')
            selectors[i] = '#output'
          }
          else if (code && /^(?:pre\s+)?(?:code)?\.hljs[\w .,:*-]*$/.test(selector)) {
            selectors[i] = `#output ${selector}`
          }
          else if (/^(?:section(?:$|[\s.:>[])|\.mermaid-diagram\s)/.test(selector)) {
            selectors[i] = `#output ${selector}`
          }
          else if (!/^#output(?:$|[\s.:>[])/.test(selector)) {
            throw new Error('Unscoped article CSS')
          }
        }
        for (const name of Array.from(row.style)) {
          const value = row.style.getPropertyValue(name)
          if (/url\s*\(|expression\s*\(/i.test(value))
            throw new Error('Unsafe article resource')
          if (name === 'position' && /fixed|sticky/i.test(value))
            throw new Error('Unsafe article positioning')
          if (/^(?:behavior|-moz-binding|z-index)$/.test(name))
            throw new Error('Unsafe article style')
        }
        return `${selectors.join(', ')} {${row.style.cssText}}`
      }).join('\n')
    }
    if (css.trim() && !style.sheet?.cssRules.length)
      throw new Error('Invalid article CSS')
    return style.sheet ? rules(style.sheet.cssRules) : ''
  }
  finally { style.remove() }
}

export function validateThemeSnapshot(value: unknown): ThemeSnapshot {
  const theme = themeSchema.parse(value)
  theme.css = validateArticleCss(theme.css)
  if (theme.customCss !== undefined)
    theme.customCss = validateArticleCss(wrapCSSWithScope(theme.customCss, '#output'))
  theme.codeCss = validateArticleCss(theme.codeCss, true)
  theme.settings.codeBlockTheme = `${import.meta.env.BASE_URL}yanhui-code.css`
  return theme
}

export function renderSnapshotCss(snapshot: ThemeSnapshot): string {
  return processCSS(`${snapshot.css}\n${wrapCSSWithScope(snapshot.customCss ?? '', '#output')}\n${generateCSSVariables({ ...snapshot.settings, isUseIndent: snapshot.indent, isUseJustify: snapshot.justify })}`)
}
