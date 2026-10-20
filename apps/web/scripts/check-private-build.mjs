import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export function assertCleanPrivateSource(root) {
  const forbidden = ['src/yanhui/sample.md', 'src/yanhui/assets.json', ...readdirSync(root).filter(name => /^\.env.*\.local$/.test(name))]
  for (const file of forbidden) {
    if (existsSync(path.join(root, file)))
      throw new Error(`Private build refused: ${file}; build from a clean source export, never delete local drafts.`)
  }
}
export function buildFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? buildFiles(path.join(root, entry.name)).map(file => `${entry.name}/${file}`) : [entry.name])
}
export function checkPrivateBuild(root) {
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error('Private build directory missing')
  const required = ['index.html', 'private-sw.js', 'manifest.webmanifest', 'brand-icon.png', 'static/libs/mathjax/tex-svg.js', 'private-build.json']
  for (const file of required) {
    if (!existsSync(path.join(root, file)))
      throw new Error(`Missing private asset: ${file}`)
  }
  const proof = JSON.parse(readFileSync(path.join(root, 'private-build.json'), 'utf8'))
  if (proof.cleanSource !== true || proof.schemaVersion !== 1)
    throw new Error('Missing clean-source build proof')
  const banned = /github_pat_\w{20,}|gh[pousr]_[a-z\d]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https:\/\/(?:api\.doocs\.org|md-api\.doocs\.org)|googletagmanager\.com|google-analytics\.com|hm\.baidu\.com\/hm\.js|Jev 接入实践（排版试用副本）/i
  for (const file of buildFiles(root)) {
    if (/\.(?:js|html|json|css|map)$/.test(file) && banned.test(readFileSync(path.join(root, file), 'utf8')))
      throw new Error(`Forbidden private or upstream content: ${file}`)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--source')
      assertCleanPrivateSource(path.resolve(process.argv[3] ?? '.'))
    else checkPrivateBuild(path.resolve(process.argv[2] ?? 'dist-private'))
    process.stdout.write('Private build checks passed.\n')
  }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
