import { Marked } from 'marked'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markedMermaid, renderMermaidSvg } from './mermaid'

const mock = vi.hoisted(() => ({ theme: '', seen: [] as string[], initialize: vi.fn(), render: vi.fn() }))
vi.mock('mermaid', () => ({ default: mock }))

beforeEach(() => {
  mock.seen.length = 0
  mock.initialize.mockImplementation((config) => { mock.theme = config.theme })
  mock.render.mockImplementation(async (_id, code) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    mock.seen.push(`${code}:${mock.theme}`)
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" id="diagram"><style>#diagram .node {fill: red}</style><defs><marker id="arrow"/></defs><g id="node" marker-end="url(#arrow)"><text>A</text></g><use href="#node"/></svg>' }
  })
})

describe('mermaid instances', () => {
  it('renders parser errors as text rather than executable HTML', async () => {
    mock.render.mockRejectedValueOnce(new Error('<img src=x onerror="evil()">'))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.createElement('div')
    root.innerHTML = new Marked(markedMermaid()).parse('```mermaid\ninvalid-with-html\n```') as string
    document.body.append(root)
    try {
      await vi.waitFor(() => expect(root.querySelector('[data-md-diagram-state="error"]')).not.toBeNull())
      expect(root.querySelector('img')).toBeNull()
      expect(root.textContent).toContain('<img src=x')
    }
    finally { root.remove(); quiet.mockRestore() }
  })
  it('identicalDiagramsRenderIndependently including cached SVG references', async () => {
    const first = await renderMermaidSvg('graph LR; A-->B')
    const second = await renderMermaidSvg('graph LR; A-->B')
    const root = document.createElement('div')
    root.innerHTML = first + second
    const ids = Array.from(root.querySelectorAll('[id]'), el => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const svg of root.querySelectorAll('svg')) {
      expect(svg.querySelector('use')?.getAttribute('href')).toBe(`#${svg.querySelector('g')?.id}`)
      expect(svg.querySelector('g')?.getAttribute('marker-end')).toBe(`url(#${svg.querySelector('marker')?.id})`)
      expect(svg.querySelector('style')?.textContent).toContain(`#${svg.id} .node`)
    }
  })

  it('serializes theme initialization and rendering', async () => {
    await Promise.all([renderMermaidSvg('light-queue', 'light'), renderMermaidSvg('dark-queue', 'dark')])
    expect(mock.seen).toEqual(['light-queue:default', 'dark-queue:dark'])
    expect(mock.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', suppressErrorRendering: true }))
  })

  it('gives repeated pending diagrams separate targets in existing Markdown rendering', async () => {
    const parser = new Marked(markedMermaid())
    const html = parser.parse('```mermaid\npending-duplicate\n```\n\n```mermaid\npending-duplicate\n```') as string
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    const targets = Array.from(root.querySelectorAll('.mermaid-diagram'))
    expect(new Set(targets.map(el => el.id)).size).toBe(2)
    await vi.waitFor(() => expect(targets.every(el => el.getAttribute('data-md-diagram-state') === 'ready')).toBe(true))
    root.remove()
  })
})
