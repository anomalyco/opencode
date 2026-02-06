type FetchWithPreconnect = typeof fetch & { preconnect?: (url: string | URL) => void }

function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/opencode_csrf=([^;]+)/)
  if (match) return match[1]
  const stored = sessionStorage.getItem("opencode_csrf_token")
  return stored ?? undefined
}

export function createCsrfFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return baseFetch(input, init)
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init?.headers) {
      const initHeaders = new Headers(init.headers)
      initHeaders.forEach((value, key) => headers.set(key, value))
    }

    const csrfToken = getCsrfToken()
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)

    return baseFetch(input, { ...init, headers })
  }) as FetchWithPreconnect

  const baseWithPreconnect = baseFetch as FetchWithPreconnect
  wrapped.preconnect = (url: string | URL) => {
    if (typeof baseWithPreconnect.preconnect === "function") {
      baseWithPreconnect.preconnect(url)
    }
  }

  return wrapped as typeof fetch
}
