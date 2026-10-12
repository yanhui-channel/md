import type { PrivateContext } from './types'
import { Hono } from 'hono'
import { logout, privateAuth, requireOwner, requireSameOriginWrite } from './auth'
import { repositoryIdentity } from './github'
import { privateRoutes } from './routes'
import { SyncError, validateConfig } from './types'

const app = new Hono<PrivateContext>()
app.onError((error, c) => {
  c.header('Cache-Control', 'no-store')
  if (error instanceof SyncError) {
    if (error.retryAfter)
      c.header('Retry-After', error.retryAfter)
    return c.json({ error: error.code, detail: error.detail }, error.status)
  }
  if (error.name === 'ZodError' || error instanceof SyntaxError)
    return c.json({ error: 'invalid_payload' }, 422)
  return c.json({ error: 'request_failed' }, 503)
})
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  validateConfig(c.env)
  if (new URL(c.req.url).origin !== c.env.APP_ORIGIN)
    return c.json({ error: 'invalid_origin' }, 403)
  await next()
})
app.route('/api/auth', privateAuth)
app.use('/api/*', requireOwner, requireSameOriginWrite)
app.get('/api/me', async (c) => {
  const session = c.get('session')
  return c.json({ ownerId: session.sub, login: session.login, csrfToken: session.csrf, vaultId: await repositoryIdentity(c.env) })
})
app.post('/api/logout', logout)
app.route('/api', privateRoutes)
app.all('/api/*', c => c.json({ error: 'not_found' }, 404))
app.all('*', (c) => {
  const path = new URL(c.req.url).pathname
  if (/^\/(?:upload|cgi-bin|s|auth|sync|marketplace|webhooks|notifications)(?:\/|$)/.test(path) || !['GET', 'HEAD'].includes(c.req.method))
    return c.json({ error: 'not_found' }, 404)
  return c.env.ASSETS.fetch(c.req.raw)
})
export default app
