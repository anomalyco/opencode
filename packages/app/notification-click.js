// Shipped next to the generated service worker (see vite.pwa.ts) because the Notification constructor is
// unavailable in Chrome for Android: the app shows its notifications through ServiceWorkerRegistration.showNotification
// and this worker owns their clicks. A click callback lives in the window that created the notification (the session
// it belongs to), so every window receives the notification's key and only the one holding the callback runs it
// (createWebNotify in src/runtime/platform/web.ts). With no window left, the app opens at its restored route.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const key = event.notification.data && event.notification.data.key
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      windows.forEach((client) => client.postMessage({ type: "opencode:notificationclick", key }))

      const target = windows[0]

      if (target) return target.focus()

      return self.clients.openWindow("/")
    }),
  )
})
