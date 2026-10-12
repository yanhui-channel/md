import type { DiagramMessages } from '@md/shared/types'
import type { MarkedExtension, Token } from 'marked'
import type { MermaidToken } from '../types/marked-tokens'
import type { DiagramThemeMode } from './diagram-theme'
import { asDiagramToken, asTextTokenRenderer, isCodeToken } from '../types/marked-tokens'
import {
  diagramStateAttr,
  formatDiagramMessage,
  MD_DIAGRAM_STATE,
  MD_DIAGRAM_STATE_ATTR,
  resolveDiagramMessages,
} from '../utils/asyncDiagramState'
import { simpleHash } from '../utils/basicHelpers'
import { blockScanLimit, findAtLineStart } from '../utils/scan'
import { createSVGCache } from '../utils/svgCache'
import { uniqueSvgIds } from '../utils/svgIds'
import { diagramCacheThemeSuffix, getMermaidThemeConfig } from './diagram-theme'

let initPromise: Promise<typeof import('mermaid')['default']> | null = null

interface MermaidOptions {
  themeMode?: DiagramThemeMode
  diagramMessages?: DiagramMessages
}

type MermaidOptionsSource = MermaidOptions | (() => MermaidOptions | undefined)

export async function initializeMermaid() {
  return getMermaid()
}

function getMermaid() {
  if (!initPromise) {
    initPromise = import('mermaid').then((m) => {
      m.default.initialize(getMermaidThemeConfig())
      return m.default
    })
  }
  return initPromise
}

function buildCacheKey(code: string, themeMode?: DiagramThemeMode): string {
  return simpleHash(`${code}-${diagramCacheThemeSuffix(themeMode)}`)
}

const svgCache = createSVGCache(50)
let renderQueue: Promise<unknown> = Promise.resolve()
let instance = 0

export async function renderMermaidSvg(code: string, themeMode?: DiagramThemeMode): Promise<string> {
  const cacheKey = buildCacheKey(code, themeMode)
  const result = renderQueue.then(async () => {
    const cached = svgCache.get(cacheKey)
    if (cached)
      return uniqueSvgIds(cached)
    const mermaid = await getMermaid()
    mermaid.initialize(getMermaidThemeConfig(themeMode))
    const rendered = await mermaid.render(`mermaid-svg-${++instance}`, code)
    svgCache.set(cacheKey, rendered.svg)
    return uniqueSvgIds(rendered.svg)
  })
  renderQueue = result.catch(() => {})
  return result
}

function renderMermaid(id: string, code: string, themeMode: DiagramThemeMode | undefined, messages: DiagramMessages) {
  if (typeof window === `undefined`)
    return

  const handleResult = (svg: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.innerHTML = svg
      el.setAttribute(MD_DIAGRAM_STATE_ATTR, MD_DIAGRAM_STATE.ready)
    }
  }

  const handleError = (error: unknown) => {
    console.error('Failed to render Mermaid:', error)
    const el = document.getElementById(id)
    if (el) {
      const detail = error instanceof Error ? error.message : String(error)
      const message = document.createElement('div')
      message.style.cssText = 'color: red; padding: 10px; border: 1px solid red;'
      message.textContent = formatDiagramMessage(messages.mermaidError, detail)
      el.replaceChildren(message)
      el.setAttribute(MD_DIAGRAM_STATE_ATTR, MD_DIAGRAM_STATE.error)
    }
  }

  void renderMermaidSvg(code, themeMode)
    .then(handleResult)
    .catch(handleError)
}

export function markedMermaid(options?: MermaidOptionsSource): MarkedExtension {
  const resolveOptions = () => typeof options === 'function' ? options() : options
  const className = 'mermaid-diagram'

  return {
    extensions: [
      {
        name: 'mermaid',
        level: 'block',
        start(src: string) {
          return findAtLineStart(src, '```mermaid', blockScanLimit(src))
        },
        tokenizer(src: string) {
          const match = /^```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(src)
          if (match) {
            return {
              type: 'mermaid',
              raw: match[0],
              text: match[1].trim(),
            }
          }
        },
        renderer: asTextTokenRenderer((token: MermaidToken) => {
          const code = token.text
          const currentOptions = resolveOptions()
          const themeMode = currentOptions?.themeMode
          const cacheKey = buildCacheKey(code, themeMode)
          const messages = resolveDiagramMessages(currentOptions?.diagramMessages)

          const cached = svgCache.get(cacheKey)
          if (cached) {
            return `<!--mermaid-start--><div class="${className}" ${diagramStateAttr(MD_DIAGRAM_STATE.ready)}>${uniqueSvgIds(cached)}</div><!--mermaid-end-->`
          }

          const id = `mermaid-${++instance}`
          renderMermaid(id, code, themeMode, messages)

          return `<!--mermaid-start--><div id="${id}" class="${className}" ${diagramStateAttr(MD_DIAGRAM_STATE.loading)}>${messages.mermaidLoading}</div><!--mermaid-end-->`
        }),
      },
    ],
    walkTokens(token: Token) {
      if (isCodeToken(token) && token.lang === 'mermaid') {
        asDiagramToken<MermaidToken>(token, 'mermaid')
      }
    },
  }
}
