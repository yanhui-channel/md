import type { PerThemeSettings } from '../configs/style'
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
export const themeSchema = z.object({
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

export function assertNoCssResources(css: string): void {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/[\\<]|(?:url|expression|(?:-webkit-)?image(?:-set)?|(?:-webkit-)?cross-fade|paint|element|src)\s*\(|@(?:import|font-face|namespace|document|supports|keyframes)/i.test(plain))
    throw new Error('Unsafe article CSS')
}
