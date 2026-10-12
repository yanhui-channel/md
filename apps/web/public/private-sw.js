/* global __PRIVATE_MANIFEST__ */
/* Replaced with a content-hashed, public-static-only manifest at build time. */
const manifest = __PRIVATE_MANIFEST__
const cacheName = `yanhui-private-shell-${manifest.version}`
const files = new Set(manifest.files)
async function announce(type) {
  for (const client of await globalThis.clients.matchAll({ includeUncontrolled: true }))
    client.postMessage({ type })
}
globalThis.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    try {
      await cache.addAll(manifest.files.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })))
    }
    catch (error) { await caches.delete(cacheName); throw error }
  })())
})
globalThis.addEventListener('activate', (event) => {
  // Old tabs may still import old chunks; activation never deletes their caches or drafts.
  event.waitUntil(globalThis.clients.claim().then(() => announce('OFFLINE_READY')))
})
globalThis.addEventListener('message', (event) => {
  if (event.data?.type === 'COUNT_WINDOWS')
    event.waitUntil(globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => event.ports[0]?.postMessage(windows.length)))
  if (event.data?.type === 'ACTIVATE_UPDATE')
    event.waitUntil(globalThis.skipWaiting())
  if (event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName)
      for (const url of manifest.files) {
        if (!await cache.match(url)) {
          event.source?.postMessage({ type: 'OFFLINE_INCOMPLETE' }); return
        }
      }
      event.source?.postMessage({ type: 'OFFLINE_READY' })
    })())
  }
})
globalThis.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== globalThis.location.origin || url.pathname.startsWith('/api/'))
    return
  const entry = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')
  if (!entry && (!url.pathname.startsWith('/static/') || url.search) && !files.has(url.pathname))
    return
  event.respondWith((async () => {
    const path = entry ? '/' : url.pathname
    const current = await (await caches.open(cacheName)).match(path)
    if (current)
      return current
    for (const name of await caches.keys()) {
      if (name.startsWith('yanhui-private-shell-')) {
        const old = await (await caches.open(name)).match(path)
        if (old)
          return old
      }
    }
    // Never fill caches from runtime requests (including images or authenticated responses).
    return fetch(request)
  })())
})
