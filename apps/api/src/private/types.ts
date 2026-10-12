export interface PrivateEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> }
  APP_ORIGIN: string
  ALLOWED_GITHUB_USER_ID: string
  DATA_REPO_OWNER: string
  DATA_REPO_NAME: string
  DATA_REPO_BRANCH: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  DATA_REPO_TOKEN: string
  SESSION_SECRET: string
}
export interface PrivateSession { sub: string, login: string, csrf: string, exp: number }
export interface PrivateContext { Bindings: PrivateEnv, Variables: { session: PrivateSession } }

export class SyncError extends Error {
  constructor(public code: string, public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503 = 503, public detail?: unknown, public retryAfter?: string) {
    super(code)
  }
}

export function validateConfig(env: PrivateEnv): void {
  if (!env.APP_ORIGIN || new URL(env.APP_ORIGIN).origin !== env.APP_ORIGIN || !env.APP_ORIGIN.startsWith('https://')
    || !/^\d+$/.test(env.ALLOWED_GITHUB_USER_ID) || !/^[\w-]+$/.test(env.DATA_REPO_OWNER)
    || !/^[\w.-]+$/.test(env.DATA_REPO_NAME) || !/^[\w/-]+$/.test(env.DATA_REPO_BRANCH)
    || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.DATA_REPO_TOKEN || env.SESSION_SECRET?.length < 32 || !env.SESSION_SECRET) {
    throw new SyncError('configuration_required')
  }
}
