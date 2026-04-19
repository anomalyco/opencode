self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  if (!event.data) return
  event.waitUntil(
    (async () => {
      let payload
      try {
        payload = event.data.json()
      } catch {
        return
      }
      if (!payload || typeof payload !== "object") return
      const title = typeof payload.title === "string" ? payload.title : "OpenCode"
      const data = payload.data && typeof payload.data === "object" ? payload.data : {}
      await self.registration.showNotification(title, {
        badge: typeof payload.badge === "string" ? payload.badge : "/notification-badge.svg",
        body: typeof payload.body === "string" ? payload.body : "",
        data,
        icon: typeof payload.icon === "string" ? payload.icon : "/favicon-96x96-v3.png",
        requireInteraction: payload.requireInteraction === true,
        tag: typeof payload.tag === "string" ? payload.tag : undefined,
      })
    })(),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const href =
        event.notification.data && typeof event.notification.data === "object" && typeof event.notification.data.href === "string"
          ? event.notification.data.href
          : "/"
      const target = new URL(href, self.location.origin).toString()
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const current = all.find((client) => client.url.startsWith(self.location.origin))
      if (current) {
        current.postMessage({ type: "notification.open", href })
        await current.focus()
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
