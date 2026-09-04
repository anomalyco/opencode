// Push uses a separate, non-page scope. Do not claim clients or change the offline worker.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()))

function destination(value) {
  if (typeof value !== "string" || !URL.canParse(value)) return
  const url = new URL(value)
  const key = new URL(self.registration.scope).pathname.match(/^\/push\/([^/]+)\/$/)?.[1]
  if (!key || url.origin !== self.location.origin || url.username || url.password) return
  if (!url.pathname.startsWith(`/server/${key}/session/`)) return
  if (!/^[A-Za-z0-9_-]+$/.test(url.pathname.slice(`/server/${key}/session/`.length))) return
  if (url.search || url.hash) return
  return url
}

self.addEventListener("push", (event) => {
  // Every push must display a notification, even with a visible app (userVisibleOnly).
  const payload = (() => {
    try {
      return event.data?.json()
    } catch {
      return undefined
    }
  })()
  const valid = payload && typeof payload.title === "string" && typeof payload.body === "string"
  const url = destination(payload?.url)
  event.waitUntil(
    self.registration.showNotification(valid ? payload.title : "OpenCode", {
      body: valid ? payload.body : "",
      tag: typeof payload?.tag === "string" ? payload.tag : undefined,
      data: { url: url?.href },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = destination(event.notification.data?.url)
  if (!url) return
  event.waitUntil(
    (async () => {
      const prefix = url.pathname.slice(0, url.pathname.indexOf("/session/")) + "/"
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const candidates = windows.filter((client) => {
        if (!URL.canParse(client.url)) return false
        const current = new URL(client.url)
        return current.origin === url.origin && current.pathname.startsWith(prefix)
      })
      const client = candidates.find((client) => client.url === url.href) ?? candidates[0]
      if (client) {
        const target = client.url === url.href ? client : await client.navigate(url.href)
        if (target) return target.focus()
      }
      return self.clients.openWindow(url.href)
    })(),
  )
})
