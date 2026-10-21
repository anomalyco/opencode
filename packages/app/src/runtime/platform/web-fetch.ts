export function createWebFetch(): typeof fetch {
  const auth = { refreshing: false }
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init)
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (response.status !== 401 || url.origin !== location.origin || auth.refreshing) return response

      // A persistent 401 (such as an incorrect server password) must not cause a reload loop.
      const key = "opencode.auth-refresh"
      if (Date.now() - Number(sessionStorage.getItem(key)) < 60_000) return response
      sessionStorage.setItem(key, String(Date.now()))
      auth.refreshing = true

      // The navigation fallback serves cached HTML even with a fresh query string. Unregister
      // before navigating so the next document request reaches the SSO proxy.
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.getRegistration().then((registration) => registration?.unregister())
      }
      location.replace(`/?auth_refresh=${Date.now()}`)
      return response
    },
    { preconnect: fetch.preconnect },
  )
}
