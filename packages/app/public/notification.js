self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data.url
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((client) => client.url === url)
      // Client.url can be stale after client-side navigation, so restore the route before focusing it.
      if (client) return client.navigate(url).then((client) => client?.focus() ?? self.clients.openWindow(url))
      return self.clients.openWindow(url)
    }),
  )
})
