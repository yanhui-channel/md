import { expect, it, vi } from 'vitest'

it('privateMathUsesLocalRuntime', async () => {
  vi.resetModules()
  Object.assign(window, { __MD_PRIVATE_OFFLINE__: true })
  const { loadMathJax, MATHJAX_LOCAL_URL } = await import('./mathjax')
  const loading = loadMathJax()
  const script = document.getElementById('MathJax-script') as HTMLScriptElement
  expect(script.getAttribute('src')).toBe(MATHJAX_LOCAL_URL)
  script.dispatchEvent(new Event('load'))
  await loading
  script.remove()
  Object.assign(window, { __MD_PRIVATE_OFFLINE__: false })
})
