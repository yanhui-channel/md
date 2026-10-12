import DOMPurify from 'isomorphic-dompurify'

export function safeVisualUrl(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- Browsers ignore these characters in URL schemes.
  const compact = value.replace(/[\u0000-\u0020\u007F]/g, '')
  return !/^[a-z][a-z\d+.-]*:/i.test(compact) || /^(?:https?:|mailto:|tel:)/i.test(compact)
}

export function safeStyleValue(property: string, value: string): string | null {
  if (/[\\{};]|url\s*\(|var\s*\(|expression\s*\(/i.test(value))
    return null
  const number = Number.parseFloat(value)
  switch (property) {
    case 'color': case 'background-color':
      return /^(?:#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(value) && CSS.supports(property, value) ? value : null
    case 'font-size':
      return /^\d+(?:\.\d+)?px$/.test(value) && number >= 10 && number <= 48 ? value : null
    case 'line-height':
      return /^\d+(?:\.\d+)?$/.test(value) && number >= 1 && number <= 3 ? value : null
    case 'margin-bottom':
      return /^\d+(?:\.\d+)?px$/.test(value) && number >= 0 && number <= 80 ? value : null
    case 'text-align':
      return ['left', 'center', 'right', 'justify'].includes(value) ? value : null
    case 'width': case 'min-width':
      return /^\d+(?:\.\d+)?(?:px|%)$/.test(value) && number > 0 && number <= (value.endsWith('%') ? 100 : 2400) ? value : null
    case 'height':
      return value === 'auto' ? value : null
    case 'display':
      return value === 'block' ? value : null
    case 'margin-left': case 'margin-right':
      return ['auto', '0px'].includes(value) ? value : null
    default:
      return null
  }
}

export function sanitizeVisualHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'a', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col', 'img', 'pre', 'code'],
    ALLOWED_ATTR: ['style', 'data-visual', 'data-source-block', 'src', 'alt', 'title', 'href', 'start', 'width', 'align', 'colwidth', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
  })
  for (const el of template.content.querySelectorAll<HTMLElement>('*')) {
    const style = document.createElement('span').style
    for (const property of Array.from(el.style)) {
      const value = safeStyleValue(property, el.style.getPropertyValue(property))
      if (value !== null)
        style.setProperty(property, value)
    }
    el.removeAttribute('style')
    if (style.cssText)
      el.setAttribute('style', style.cssText)
    for (const attr of ['href', 'src']) {
      const value = el.getAttribute(attr)
      if (value && !safeVisualUrl(value))
        el.removeAttribute(attr)
    }
    for (const attr of ['colwidth', 'width', 'colspan', 'rowspan']) {
      const value = el.getAttribute(attr)
      if (value !== null && (!/^\d+(?:,\d+)*$/.test(value) || value.split(',').some(n => Number(n) < 1 || Number(n) > 2400)))
        el.removeAttribute(attr)
    }
  }
  return template.innerHTML
}
