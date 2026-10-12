import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const require = createRequire(import.meta.url)
const port = Number(process.env.PRIVATE_TEST_PORT ?? 5196)
const dist = path.resolve(process.env.PRIVATE_TEST_DIST ?? 'dist-private')
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: './test-results/private',
  reporter: [['list'], ['html', { outputFolder: './playwright-report/private', open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'zh-CN', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: { command: `node "${vite}" preview --outDir "${dist}" --base / --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30000 },
})
