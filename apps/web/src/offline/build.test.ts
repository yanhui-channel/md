import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../scripts/check-private-build.mjs', import.meta.url))
it('rejectsPrivateSeedBuild', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'private-build-test-'))
  try {
    expect(() => execFileSync(process.execPath, [script, '--source', root], { stdio: 'pipe' })).not.toThrow()
    mkdirSync(path.join(root, 'src/yanhui'), { recursive: true })
    writeFileSync(path.join(root, 'src/yanhui/sample.md'), 'private-test-marker')
    expect(() => execFileSync(process.execPath, [script, '--source', root], { stdio: 'pipe' })).toThrow()
    rmSync(path.join(root, 'src/yanhui/sample.md'))
    writeFileSync(path.join(root, '.env.private.local'), 'SECRET=fake')
    expect(() => execFileSync(process.execPath, [script, '--source', root], { stdio: 'pipe' })).toThrow()
    expect(() => execFileSync(process.execPath, [script, path.join(root, 'missing')], { stdio: 'pipe' })).toThrow()
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})
