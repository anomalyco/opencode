/// <reference lib="webworker" />
const CACHE_NAME = "opencode-v1"

/** @param {string} url */
function isHashedAsset(url) {
  return /\/assets\/[^/]+[-.][\da-f]{8,}\.\w+$/.test(url)
}

/** @param {string} url */
function isStaticAsset(url) {
  return /\.(?:js|css|woff2?|png|svg|ico|webmanifest)(?:\?|$)/.test(url)
}

/** @param {string} url */
function isAPIorEvent(url) {
  const path = new URL(url).pathname
  return path.startsWith("/api/") || path.endsWith("/event") || path.endsWith("/prompt_async")
}

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  if (isAPIorEvent(request.url)) return

  // Navigation requests: stale-while-revalidate for instant page loads
  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match("/index.html").then((cached) => {
          const fresh = fetch(request).then((response) => {
            if (response.ok) cache.put("/index.html", response.clone())
            return response
          })
          if (cached) return fresh.catch(() => cached)
          return fresh
        }),
      ),
    )
    return
  }

  // Hashed assets: cache-first (immutable filenames)
  if (isHashedAsset(request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone())
              return response
            }),
        ),
      ),
    )
    return
  }

  // Other static assets: stale-while-revalidate
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fresh = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone())
            return response
          })
          if (cached) return fresh.catch(() => cached)
          return fresh
        }),
      ),
    )
    return
  }
})
