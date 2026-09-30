// Sign-in proxies redirect expired API requests to another origin, which fetch rejects, while the service worker
// serves navigations from cache. A `reauth` navigation skips the worker so the proxy can sign the user in again.
// After one attempt, wait for a same-origin request to succeed before trying again.
let armed = !new URLSearchParams(location.search).has("reauth")

export const fetchThroughSignInProxy: typeof globalThis.fetch = Object.assign(
  async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(resource, init)
    const sameOrigin = new URL(request.url).origin === location.origin
    return fetch(request).then(
      (response) => {
        if (sameOrigin && response.ok) armed = true
        return response
      },
      (error) => {
        if (armed && sameOrigin && !request.signal.aborted) reauthenticate()
        throw error
      },
    )
  },
  // Bun's fetch type carries preconnect; the browser never calls it.
  { preconnect: () => {} },
)

function reauthenticate() {
  armed = false
  // The timeout keeps a socket that died while the device slept from blocking recovery.
  fetch("/api/info", { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) })
    .catch(() => undefined)
    .then((response) => {
      armed = response?.type !== "opaqueredirect"
      if (armed) return
      const url = new URL(location.href)
      url.searchParams.set("reauth", "1")
      location.assign(url)
    })
}
