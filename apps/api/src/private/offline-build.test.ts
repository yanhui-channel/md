import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { privateOfflinePlugin } from '../../../web/plugins/private-offline'
import app from './index'
import { testEnv } from './test-fixtures'

it('precaches only successful canonical routes through the private Worker', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'private-routes-test-'))
  try {
    const output = path.join(root, 'dist')
    for (const folder of ['src/yanhui', 'public', 'dist/upload'])
      mkdirSync(path.join(root, folder), { recursive: true })
    writeFileSync(path.join(root, 'src/yanhui/avatar.png'), 'public test icon')
    writeFileSync(path.join(root, 'public/private-sw.js'), readFileSync(path.resolve('../web/public/private-sw.js')))
    writeFileSync(path.join(output, 'index.html'), '<html>Public shell</html>')
    writeFileSync(path.join(output, 'upload/.gitkeep'), '')
    const plugin = privateOfflinePlugin()
    if (typeof plugin.configResolved !== 'function' || typeof plugin.closeBundle !== 'function')
      throw new Error('Missing private build hooks')
    await Reflect.apply(plugin.configResolved, plugin, [{ root, base: '/', build: { outDir: 'dist' } }])
    await Reflect.apply(plugin.closeBundle, plugin, [])
    const source = readFileSync(path.join(output, 'private-sw.js'), 'utf8')
    const manifest = JSON.parse(source.match(/const manifest = (.*)/)![1]) as { files: string[] }
    const env = { ...testEnv, ASSETS: { fetch: async (request: Request) => {
      const pathname = new URL(request.url).pathname
      if (pathname === '/index.html')
        return Response.redirect('https://editor.test/', 307)
      return new Response('public asset', { status: existsSync(path.join(output, pathname === '/' ? 'index.html' : pathname)) ? 200 : 404 })
    } } }
    const failures: string[] = []
    for (const file of manifest.files) {
      const response = await app.request(`https://editor.test${file}`, {}, env)
      if (response.status !== 200)
        failures.push(`${file}: ${response.status}`)
    }
    expect(failures).toEqual([])
    expect(manifest.files).toContain('/')
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})
