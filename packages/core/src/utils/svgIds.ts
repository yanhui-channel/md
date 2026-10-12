let sequence = 0

/** Cached SVGs need instance-local definitions as well as a unique root ID. */
export function uniqueSvgIds(svg: string): string {
  if (typeof DOMParser === 'undefined')
    return svg
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  if (root.localName !== 'svg')
    throw new Error('Invalid SVG')
  const prefix = `md-svg-${++sequence}-`
  const elements = [root, ...root.querySelectorAll('*')]
  const ids = new Map(elements.filter(el => el.id).map(el => [el.id, `${prefix}${el.id}`]))
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      let value = attr.value
      if (attr.name === 'id')
        value = ids.get(value) ?? value
      else if (attr.localName === 'href' && value.startsWith('#'))
        value = `#${ids.get(value.slice(1)) ?? value.slice(1)}`
      else if (['aria-labelledby', 'aria-describedby'].includes(attr.name))
        value = value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ')
      else
        value = value.replace(/url\(['"]?#([^)'"\s]+)['"]?\)/g, (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match)
      attr.value = value
    }
    if (el.localName === 'style') {
      el.textContent = (el.textContent ?? '').replace(/#([\w-]+)/g, (match, id) => ids.has(id) ? `#${ids.get(id)}` : match)
    }
  }
  return new XMLSerializer().serializeToString(root)
}
