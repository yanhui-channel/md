import { afterEach, expect, it, vi } from 'vitest'
import { github } from './github'
import { testEnv } from './test-fixtures'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it.each([403, 429])('waits until the primary limit resets on HTTP %s', async (status) => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000)
  vi.stubGlobal('fetch', async () => Response.json({}, { status, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800001800' } }))
  await expect(github(testEnv, '')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: '1800' })
})

it('recognizes secondary throttling without retry headers', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, { status: 403 }))
  await expect(github(testEnv, '')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: '60' })
})

it.each([
  { message: 'Resource not accessible by personal access token', code: 'repository_authorization_required' },
  { message: 'x'.repeat(9000), code: 'repository_authorization_required' },
])('does not mistake permission errors or oversized errors for throttling', async ({ message, code }) => {
  vi.stubGlobal('fetch', async () => Response.json({ message }, { status: 403 }))
  await expect(github(testEnv, '')).rejects.toMatchObject({ code, status: 403 })
})

it('honors retry-after before reset or the fallback', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}, { status: 403, headers: { 'retry-after': '120', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' } }))
  await expect(github(testEnv, '')).rejects.toMatchObject({ code: 'rate_limited', retryAfter: '120' })
})
