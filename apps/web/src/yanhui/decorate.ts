export function headingOutline(headings: { level: number, text: string, title?: boolean }[]) {
  let section = 0
  const stack: { level: number, count: number }[] = []
  return headings.map((heading) => {
    if (heading.title)
      return { number: '', depth: 0, section: 0, prefixLength: 0, width: '0em' }
    while (stack.length && stack[stack.length - 1]!.level > heading.level)
      stack.pop()
    if (!stack.length || (stack.length === 1 && stack[0]!.level === heading.level)) {
      stack.splice(0, stack.length, { level: heading.level, count: ++section })
    }
    else if (stack[stack.length - 1]!.level === heading.level) {
      stack[stack.length - 1]!.count++
    }
    else {
      stack.push({ level: heading.level, count: 1 })
    }
    const number = stack.map(item => item.count).join('.') + (stack.length === 1 ? '.' : '')
    const prefix = /^(?:\d+(?:\.\d+)*[.、](?!\d)\s*|\d+(?:\.\d+)+\s+)/u.exec(heading.text)
    return { number, depth: stack.length, section, prefixLength: prefix?.[0].length ?? 0, width: `${Math.max(1.65, number.length * 0.62 + 0.45)}em` }
  })
}

export function headingAttributes(heading: ReturnType<typeof headingOutline>[number]) {
  return {
    'class': 'yh-heading',
    'data-yh-depth': String(heading.depth),
    'data-yh-section': String((heading.section - 1) % 4),
    'style': `padding-left: ${heading.width};`,
  }
}

function removePrefix(element: Node, length: number): number {
  for (const child of [...element.childNodes]) {
    if (!length)
      break
    if (child.nodeType === 3) {
      const text = child.textContent ?? ''
      child.textContent = text.slice(length)
      length = Math.max(0, length - text.length)
    }
    else { length = removePrefix(child, length) }
  }
  return length
}

export function decorateArticle(root: HTMLElement, avatar: string): void {
  const doc = root.ownerDocument
  root.querySelectorAll('.yh-heading-marker, .yh-heading-line').forEach(el => el.remove())
  const container = root.querySelector('.container') ?? root
  const first = [...container.children].find(el => !el.matches('.yh-brand, blockquote.md-blockquote') && !(el.tagName === 'P' && !el.textContent?.trim() && !el.querySelector('img')))
  const title = first?.tagName === 'H1' ? first : first?.matches('section[data-visual]') ? first.querySelector(':scope > h1:first-child') : null
  root.querySelectorAll('.yh-article-title').forEach(el => el.classList.remove('yh-article-title'))
  title?.classList.add('yh-article-title')
  const headings = [...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
    .filter(el => !el.closest('blockquote, li, table, pre, [data-source-block]'))
  const outline = headingOutline(headings.map(el => ({ level: Number(el.tagName.slice(1)), text: el.textContent ?? '', title: el === title })))
  headings.forEach((element, index) => {
    const heading = outline[index]!
    if (!heading.number)
      return
    removePrefix(element, heading.prefixLength)
    const attrs = headingAttributes(heading)
    element.classList.add(attrs.class)
    element.setAttribute('data-yh-depth', attrs['data-yh-depth'])
    element.setAttribute('data-yh-section', attrs['data-yh-section'])
    element.style.paddingLeft = heading.width
    const marker = doc.createElement('span')
    marker.className = 'yh-heading-marker'
    marker.textContent = `${heading.number} `
    marker.style.width = heading.width
    marker.style.marginLeft = `-${heading.width}`
    element.prepend(marker)
    if (heading.depth === 1) {
      const line = doc.createElement('span')
      line.className = 'yh-heading-line'
      element.append(line)
    }
  })
  if (!root.querySelector('.yh-brand')) {
    const brand = doc.createElement('p')
    brand.className = 'yh-brand'
    const image = doc.createElement('img')
    image.src = avatar
    image.alt = ''
    image.width = 26
    image.height = 24
    brand.append(image, doc.createTextNode('衍辉 channel'))
    if (title)
      title.after(brand)
    else
      (root.querySelector('.container') ?? root).prepend(brand)
  }

  root.querySelectorAll('li').forEach((element) => {
    const first = element.firstChild
    if (first?.nodeType !== 3)
      return
    const match = /^(?:\d+\.\s+|•\s+)/u.exec(first.textContent ?? '')
    if (!match)
      return
    const marker = doc.createElement('span')
    marker.className = 'yh-list-marker'
    marker.textContent = match[0]
    first.textContent = first.textContent!.slice(match[0].length)
    element.insertBefore(marker, first)
    element.classList.add('yh-marked')
  })
}
