const version = "oc-v1"
const shell = `${version}-shell`
const assets = ["/", "/site.webmanifest", "/favicon-v3.svg", "/favicon-v3.ico", "/favicon-96x96-v3.png", "/apple-touch-icon-v3.png", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(shell).then((cache) => cache.addAll(assets)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== shell).map((key) => caches.delete(key)),
      ).then(() => self.clients.claim()),
    ),
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)
  if (url.origin !== location.origin) return

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(shell)
        return (await cache.match("/")) ?? Response.error()
      }),
    )
    return
  }

  if (url.pathname.startsWith("/assets/") || assets.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fresh = fetch(event.request)
          .then(async (response) => {
            const cache = await caches.open(shell)
            cache.put(event.request, response.clone())
            return response
          })
          .catch(() => cached ?? Response.error())

        return cached ?? fresh
      }),
    )
  }
})
