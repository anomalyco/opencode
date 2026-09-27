// Sign-in proxies redirect expired API requests to another origin, which fetch rejects, while the service
// worker answers navigations from cache. A `reauth` navigation skips the worker (vite.pwa.ts) so the proxy
// can sign the user in. After one attempt, wait for a request to succeed before trying again.
let armed = !new URLSearchParams(location.search).has("reauth")
let probing = false

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
        if (armed && sameOrigin && !request.signal.aborted) void reauthenticate()
        throw error
      },
    )
  },
  // Bun's fetch type carries preconnect; the browser never calls it.
  { preconnect: () => {} },
)

async function reauthenticate() {
  if (probing) return
  probing = true
  // A socket that died while the device slept can stall fetch for minutes and block later checks.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const response = await fetch("/api/info", { redirect: "manual", cache: "no-store", signal: controller.signal }).catch(
    () => undefined,
  )
  clearTimeout(timer)
  probing = false
  if (response?.type !== "opaqueredirect") return
  armed = false
  const url = new URL(location.href)
  url.searchParams.set("reauth", "1")
  location.assign(url)
}
