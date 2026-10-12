import type { PerThemeSettings } from '@md/shared/configs'
import { generateCSSVariables, processCSS } from '@md/core/theme'
import { z } from 'zod'

export interface ThemeSnapshot {
  id: string
  settings: PerThemeSettings
  css: string
  codeCss: string
  previewWidth: string
  legend: string
  citeStatus: boolean
  countStatus: boolean
  indent: boolean
  justify: boolean
}

const color = z.string().max(80).regex(/^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\)|var\(--md-primary-color\))$/i)
const bounded = (suffix: string, min: number, max: number) => z.string().regex(new RegExp(`^\\d+(?:\\.\\d+)?${suffix}$`)).refine(value => Number.parseFloat(value) >= min && Number.parseFloat(value) <= max)
const themeSchema = z.object({
  id: z.string().min(1).max(120),
  settings: z.object({
    primaryColor: color,
    linkColor: color,
    blockquoteBackground: color,
    fontFamily: z.string().min(1).max(500).regex(/^[\p{L}\p{N}\s,'"_-]+$/u),
    fontSize: bounded('px', 10, 48),
    lineHeight: bounded('', 1, 3),
    blockSpacing: bounded('', 0, 5),
    codeBlockTheme: z.string().max(1000),
    headingStyles: z.partialRecord(z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']), z.enum(['default', 'custom', 'color-only', 'border-bottom', 'border-left'])),
    isShowLineNumber: z.boolean(),
    isMacCodeBlock: z.boolean(),
  }),
  css: z.string().max(500000),
  codeCss: z.string().max(100000),
  previewWidth: z.string().max(20).regex(/^(?:\d+(?:px|%)|auto|w-full|w-\[375px\])$/),
  legend: z.enum(['none', 'alt', 'title', 'alt-title', 'title-alt', 'filename']),
  citeStatus: z.boolean(),
  countStatus: z.boolean(),
  indent: z.boolean(),
  justify: z.boolean(),
})

export function validateArticleCss(css: string, code = false): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Reject resource loads and escapes before the browser parses an inert sheet.
  if (/[\\<]|(?:url|expression|(?:-webkit-)?image(?:-set)?|(?:-webkit-)?cross-fade|paint|element|src)\s*\(|@(?:import|font-face|namespace|document|supports|keyframes)/i.test(css))
    throw new Error('Unsafe article CSS')
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
  theme.codeCss = validateArticleCss(theme.codeCss, true)
  theme.settings.codeBlockTheme = `${import.meta.env.BASE_URL}yanhui-code.css`
  return theme
}

export function renderSnapshotCss(snapshot: ThemeSnapshot): string {
  return processCSS(`${snapshot.css}\n${generateCSSVariables({ ...snapshot.settings, isUseIndent: snapshot.indent, isUseJustify: snapshot.justify })}`)
}
