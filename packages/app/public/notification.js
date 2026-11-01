// Loaded into the main offline worker so notifications created by the page can open the
// matching session. Push notifications use their own worker under /push/<server-key>/.
function destination(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- notification data is untrusted
  if (typeof value !== "string" || !URL.canParse(value)) return
  const url = new URL(value)

  if (url.origin !== self.location.origin || url.username || url.password) return

  if (url.pathname !== "/" && !/^\/server\/[A-Za-z0-9_-]+\/session\/[A-Za-z0-9_-]+$/.test(url.pathname)) return

  if (url.search || url.hash) return

  return url
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = destination(event.notification.data?.url)

  if (!url) return
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const exact = windows.find((client) => client.url === url.href)

      if (exact) return exact.focus()

      const sameOrigin = windows.find((client) => {
        try {
          return new URL(client.url).origin === url.origin
        } catch {
          return false
        }
      })

      if (sameOrigin) {
        const target = await sameOrigin.navigate(url.href)

        if (target) return target.focus()
      }

      return self.clients.openWindow(url.href)
    })(),
  )
})
