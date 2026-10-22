import { isUnauthorizedError } from "@opencode/client"

export function createWebFetch(): typeof fetch {
  const auth = { refreshing: false }

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)

      if (url.origin !== location.origin || !/\/api(?:\/|$)/.test(url.pathname)) return fetch(input, init)

      // Do not follow SSO redirects into a cross-origin login page: browsers hide the
      // redirect as opaqueredirect, whereas following it can fail with an opaque CORS error.
      const response = await fetch(input, { ...init, redirect: "manual" })
      const key = "opencode.auth-refresh"

      if (auth.refreshing) return response

      // Only a successful health check after returning from SSO rearms recovery.
      if (response.ok && url.pathname.endsWith("/api/info")) sessionStorage.removeItem(key)

      if (response.status !== 401 && response.type !== "opaqueredirect") return response

      // The server's password challenge belongs to the sign-in UI, not proxy recovery.
      // Read a clone so the client can still decode the original error body.
      if (response.status === 401) {
        const body = await response.clone().json().catch(() => undefined)

        if (isUnauthorizedError(body)) return response
      }

      // A proxy that keeps rejecting requests after sign-in must not cause a reload loop.
      if (sessionStorage.getItem(key) !== null) return response

      sessionStorage.setItem(key, "pending")
      auth.refreshing = true

      // The worker excludes this query parameter from its navigation fallback.
      const destination = new URL(location.href)
      destination.searchParams.set("reauth", "1")

      location.replace(destination.href)

      return response
    },
    { preconnect: fetch.preconnect },
  )
}
