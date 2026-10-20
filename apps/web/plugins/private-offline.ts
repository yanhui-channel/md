import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { assertCleanPrivateSource, buildFiles, checkPrivateBuild } from '../scripts/check-private-build.mjs'

export function privateOfflinePlugin(): Plugin {
  let root = ''
  let output = ''
  const require = createRequire(import.meta.url)
  const coreRequire = createRequire(require.resolve('@md/core'))
  const highlightRoot = path.dirname(coreRequire.resolve('highlight.js/package.json'))
  return {
    name: 'private-offline',
    apply: 'build',
    configResolved(config) {
      root = config.root
      output = path.resolve(root, config.build.outDir)
      assertCleanPrivateSource(root)
      if (config.base !== '/')
        throw new Error('Private editor requires same-origin root base')
    },
    buildStart() {
      for (const file of readdirSync(path.join(highlightRoot, 'lib/languages')).filter(f => f.endsWith('.js') && !f.endsWith('.js.js')))
        this.emitFile({ type: 'chunk', id: path.join(highlightRoot, 'lib/languages', file), fileName: `static/libs/highlight/${file}` })
    },
    transformIndexHtml: {
      order: 'post',
      handler: html => ({
        html: html.replaceAll('/favicon.png', '/brand-icon.png'),
        tags: [
          { tag: 'script', children: 'window.__MD_PRIVATE_OFFLINE__=true', injectTo: 'head-prepend' },
          { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
          { tag: 'meta', attrs: { name: 'theme-color', content: '#ffffff' }, injectTo: 'head' },
        ],
      }),
    },
    closeBundle() {
      cpSync(path.join(path.dirname(require.resolve('mathjax/package.json')), 'es5'), path.join(output, 'static/libs/mathjax'), { recursive: true })
      cpSync(path.join(highlightRoot, 'styles'), path.join(output, 'static/libs/highlight/styles'), { recursive: true })
      cpSync(path.join(root, 'src/yanhui/avatar.png'), path.join(output, 'brand-icon.png'))
      writeFileSync(path.join(output, 'manifest.webmanifest'), JSON.stringify({ name: '衍辉 channel 编辑器', short_name: '衍辉编辑器', id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff', icons: [{ src: '/brand-icon.png', sizes: 'any', type: 'image/png', purpose: 'any' }] }))
      writeFileSync(path.join(output, 'private-build.json'), JSON.stringify({ schemaVersion: 1, cleanSource: true }))
      const files = buildFiles(output).filter(f => f !== 'private-sw.js' && f !== '_headers' && !f.startsWith('upload/') && !f.endsWith('.map')).sort()
      const hash = createHash('sha256')
      for (const file of files) hash.update(file).update(readFileSync(path.join(output, file)))
      const worker = readFileSync(path.join(root, 'public/private-sw.js'), 'utf8')
      hash.update(worker)
      writeFileSync(path.join(output, 'private-sw.js'), worker.replace('= __PRIVATE_MANIFEST__', `= ${JSON.stringify({ version: hash.digest('hex').slice(0, 20), files: files.map(f => f === 'index.html' ? '/' : `/${f}`) })}`))
      writeFileSync(path.join(output, '_headers'), '/private-sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n')
      checkPrivateBuild(output)
    },
  }
}
