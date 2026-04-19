self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

function decodeServerKey(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "include",
  }).catch(() => undefined)
  if (!response?.ok) return
  return response.json().catch(() => undefined)
}

async function syncSubscription(previousEndpoint) {
  const config = await fetchJSON("/global/push/public-key")
  if (config?.supported !== true || typeof config.publicKey !== "string") return

  const existing = await fetchJSON("/global/push/subscriptions")
  const previous = Array.isArray(existing)
    ? existing.find((item) => item && typeof item === "object" && item.endpoint === previousEndpoint)
    : undefined

  const subscription = await self.registration.pushManager
    .subscribe({
      applicationServerKey: decodeServerKey(config.publicKey),
      userVisibleOnly: true,
    })
    .catch(() => undefined)
  if (!subscription) return

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) return

  await fetch("/global/push/subscriptions", {
    body: JSON.stringify({
      deviceLabel: previous && typeof previous.deviceLabel === "string" ? previous.deviceLabel : undefined,
      enabled: previous && typeof previous.enabled === "boolean" ? previous.enabled : true,
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: {
        auth: json.keys.auth,
        p256dh: json.keys.p256dh,
      },
      notifyOnCompletion: previous && typeof previous.notifyOnCompletion === "boolean" ? previous.notifyOnCompletion : true,
      notifyOnError: previous && typeof previous.notifyOnError === "boolean" ? previous.notifyOnError : false,
      serverOrigin: self.location.origin,
      userAgent: self.navigator?.userAgent,
    }),
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  }).catch(() => undefined)
}

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(syncSubscription(event.oldSubscription?.endpoint))
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
