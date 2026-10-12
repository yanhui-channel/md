import type { MiddlewareHandler } from 'hono'
import type { PrivateContext, PrivateSession } from './types'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'

const SESSION = '__Host-yanhui-session'
const STATE = '__Host-yanhui-state'
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const
export const requireOwner: MiddlewareHandler<PrivateContext> = async (c, next) => {
  try {
    const payload = await verify(getCookie(c, SESSION) ?? '', c.env.SESSION_SECRET, 'HS256')
    if (payload.aud !== c.env.APP_ORIGIN || payload.sub !== c.env.ALLOWED_GITHUB_USER_ID || typeof payload.login !== 'string'
      || typeof payload.csrf !== 'string' || typeof payload.exp !== 'number') {
      return c.json({ error: 'login_required' }, 401)
    }
    c.set('session', payload as unknown as PrivateSession)
  }
  catch { return c.json({ error: 'login_required' }, 401) }
  await next()
}
export const requireSameOriginWrite: MiddlewareHandler<PrivateContext> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)
    && (c.req.header('Origin') !== c.env.APP_ORIGIN || c.req.header('x-csrf-token') !== c.get('session').csrf)) {
    return c.json({ error: 'invalid_origin_or_csrf' }, 403)
  }
  await next()
}

export const privateAuth = new Hono<PrivateContext>()
privateAuth.get('/github', async (c) => {
  const nonce = crypto.randomUUID()
  const exp = Math.floor(Date.now() / 1000) + 600
  const state = await sign({ nonce, exp, aud: `${c.env.APP_ORIGIN}/oauth` }, c.env.SESSION_SECRET, 'HS256')
  setCookie(c, STATE, state, { ...cookieOptions, maxAge: 600 })
  const url = new URL('https://github.com/login/oauth/authorize')
  url.search = new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: `${c.env.APP_ORIGIN}/api/auth/github/callback`, scope: 'read:user', state: nonce }).toString()
  return c.redirect(url.toString())
})
privateAuth.get('/github/callback', async (c) => {
  const saved = getCookie(c, STATE)
  deleteCookie(c, STATE, cookieOptions)
  try {
    const payload = await verify(saved ?? '', c.env.SESSION_SECRET, 'HS256')
    if (!c.req.query('state') || payload.nonce !== c.req.query('state') || payload.aud !== `${c.env.APP_ORIGIN}/oauth`)
      throw new Error('state')
  }
  catch { return c.json({ error: 'invalid_oauth_state' }, 400) }
  if (c.req.query('error'))
    return c.redirect(`${c.env.APP_ORIGIN}/?login=cancelled`)
  const code = c.req.query('code')
  if (!code || code.length > 2000)
    return c.json({ error: 'invalid_oauth_code' }, 400)
  const exchanged = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${c.env.APP_ORIGIN}/api/auth/github/callback` }),
  })
  if (!exchanged.ok)
    return c.json({ error: 'oauth_exchange_failed' }, 503)
  const token = await exchanged.json<{ access_token?: string }>()
  if (typeof token.access_token !== 'string' || !token.access_token)
    return c.json({ error: 'oauth_exchange_failed' }, 503)
  const userResponse = await fetch('https://api.github.com/user', {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { 'Authorization': `Bearer ${token.access_token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'yanhui-private-editor' },
  })
  if (!userResponse.ok)
    return c.json({ error: 'identity_unavailable' }, 503)
  const user = await userResponse.json<{ id?: number, login?: string }>()
  if (!Number.isSafeInteger(user.id) || String(user.id) !== c.env.ALLOWED_GITHUB_USER_ID || typeof user.login !== 'string')
    return c.json({ error: 'owner_only' }, 403)
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
  const session = await sign({ sub: String(user.id), login: user.login, csrf: crypto.randomUUID(), exp, aud: c.env.APP_ORIGIN }, c.env.SESSION_SECRET, 'HS256')
  setCookie(c, SESSION, session, { ...cookieOptions, maxAge: 7 * 24 * 3600 })
  return c.redirect(`${c.env.APP_ORIGIN}/`)
})

export const logout: MiddlewareHandler<PrivateContext> = async (c) => {
  deleteCookie(c, SESSION, cookieOptions)
  return c.json({ ok: true })
}
