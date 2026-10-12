import type { PrivateEnv } from './types'
import { SyncError } from './types'

export async function github<T>(env: PrivateEnv, path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = `https://api.github.com/repos/${encodeURIComponent(env.DATA_REPO_OWNER)}/${encodeURIComponent(env.DATA_REPO_NAME)}${path}`
  const response = await fetch(url, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Authorization': `Bearer ${env.DATA_REPO_TOKEN}`, 'User-Agent': 'yanhui-private-editor', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
    let secondaryLimit = false
    if (response.status === 403 && !exhausted && !response.headers.has('retry-after')) {
      const error = await readGithubJson<{ message?: unknown }>(response, 8192).catch(() => null)
      secondaryLimit = typeof error?.message === 'string' && /secondary rate limit/i.test(error.message)
    }
    if (response.status === 429 || (response.status === 403 && (exhausted || secondaryLimit || response.headers.has('retry-after')))) {
      const resetDelay = Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000
      const retry = Number(response.headers.get('retry-after'))
      const seconds = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : exhausted && Number.isFinite(resetDelay) && resetDelay > 0 ? Math.ceil(resetDelay) : 60
      throw new SyncError('rate_limited', 429, undefined, String(seconds))
    }
    if ([401, 403].includes(response.status))
      throw new SyncError('repository_authorization_required', 403)
    if (response.status === 404)
      throw new SyncError('repository_not_found', 404)
    if ([409, 422].includes(response.status))
      throw new SyncError('repository_changed', 409)
    throw new SyncError('github_unavailable')
  }
  return readGithubJson<T>(response, 45 * 1024 * 1024)
}

async function readGithubJson<T>(response: Response, maxBytes: number): Promise<T> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new SyncError('invalid_github_response')
  const parts: Uint8Array[] = []
  let length = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done)
      break
    length += chunk.value.length
    if (length > maxBytes) {
      await reader.cancel()
      throw new SyncError('github_response_too_large', 413)
    }
    parts.push(chunk.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

export async function repositoryIdentity(env: PrivateEnv): Promise<string> {
  const repo = await github<{ id: number, private: boolean, permissions?: { push?: boolean } }>(env, '')
  if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || repo.private !== true || repo.permissions?.push !== true)
    throw new SyncError('private_writable_repository_required', 403)
  return `${repo.id}:${env.DATA_REPO_BRANCH}`
}
