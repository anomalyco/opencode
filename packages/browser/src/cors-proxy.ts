// CORS proxy configuration
// In production, deploy the Cloudflare Worker from proxy/cors-worker.ts
// For local dev, use the built-in proxy or a local Hono server

export const CORS_PROXY_URL = import.meta.env.VITE_CORS_PROXY_URL || ""

/**
 * Wrap a fetch function to route API calls through the CORS proxy.
 * If no proxy URL is configured, calls go direct (requires CORS headers from the API).
 */
export function createProxiedFetch(apiKey: string): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const url = new URL(request.url)

    // Only proxy Anthropic API calls
    if (url.hostname === "api.anthropic.com" && CORS_PROXY_URL) {
      const proxyUrl = `${CORS_PROXY_URL}${url.pathname}${url.search}`
      const headers = new Headers(request.headers)
      headers.set("x-api-key", apiKey)
      headers.set("anthropic-version", "2023-06-01")

      return fetch(proxyUrl, {
        method: request.method,
        headers,
        body: request.body,
      })
    }

    // Direct call (for APIs that support CORS)
    return fetch(request)
  }
}
