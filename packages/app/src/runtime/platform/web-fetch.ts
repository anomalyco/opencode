export function createWebFetch(): typeof fetch {
  const auth = { refreshing: false }

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)

      if (url.origin !== location.origin || !/^\/api(?:\/|$)/.test(url.pathname)) return fetch(input, init)

      // Do not follow SSO redirects into a cross-origin login page: browsers hide the
      // redirect as opaqueredirect, whereas following it can fail with an opaque CORS error.
      const response = await fetch(input, { ...init, redirect: "manual" })
      const key = "opencode.auth-refresh"

      if (auth.refreshing) return response

      // Only a successful health check after returning from SSO rearms recovery.
      if (response.ok && url.pathname === "/api/info") sessionStorage.removeItem(key)

      if (response.status !== 401 && response.type !== "opaqueredirect") return response

      // A persistent 401 (such as an incorrect server password) must not cause a reload loop.
      if (sessionStorage.getItem(key) !== null) return response

      sessionStorage.setItem(key, "pending")
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
