// Dedicated push worker. It is registered under /push/<server-key>/ and never claims
// clients, so it cannot disturb the app's offline cache and update lifecycle.

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()))

function sessionDestination(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- push data is untrusted
  if (typeof value !== "string" || !URL.canParse(value)) return
  const url = new URL(value)
  const key = new URL(self.registration.scope).pathname.match(/^\/push\/([^/]+)\/$/)?.[1]

  if (!key || url.origin !== self.location.origin || url.username || url.password) return

  if (!url.pathname.startsWith(`/server/${key}/session/`)) return

  if (!/^[A-Za-z0-9_-]+$/.test(url.pathname.slice(`/server/${key}/session/`.length))) return

  if (url.search || url.hash) return

  return url
}

async function focused() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })

  return windows.some((client) => client.visibilityState === "visible" && client.focused)
}

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data?.json()
    } catch {
      return undefined
    }
  })()

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- push data is untrusted
  const title = typeof payload?.title === "string" && payload.title ? payload.title.slice(0, 100) : "OpenCode"
  const url = sessionDestination(payload?.url)
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- push data is untrusted
  const tag = typeof payload?.tag === "string" ? payload.tag.slice(0, 200) : undefined
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- push data is untrusted
  const kind = typeof payload?.kind === "string" ? payload.kind : undefined
  event.waitUntil(
    focused().then((active) =>
      self.registration.showNotification(title, {
        body: "",
        icon: new URL("/favicon.ico", self.location.origin).href,
        // Completion and error pushes stay quiet while the app is being used; permission
        // and question pushes always alert because they need an answer.
        silent: active && (kind === "agent" || kind === "errors"),
        tag,
        renotify: !!tag,
        data: { url: url?.href, kind },
      }),
    ),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = sessionDestination(event.notification.data?.url)

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

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "opencode.push.subscription-change" }))
    }),
  )
})
