export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "./error-interceptor.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

function pick(value: string | null, fallback?: string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory?: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const value = pick(request.headers.get("x-opencode-directory"), directory)
  if (!value) return request

  const url = new URL(request.url)
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }

  const next = new Request(url, request)
  next.headers.delete("x-opencode-directory")
  return next
}

function defaultFetch(request: Request) {
  const req = request as Request & { timeout?: boolean }
  req.timeout = false
  return fetch(req)
}

export function createUnauthorizedFallbackFetch(input: {
  liveFetch?: (request: Request) => ReturnType<typeof fetch>
  fallbackFetch: (request: Request) => ReturnType<typeof fetch>
}) {
  let fallback = false
  const liveFetch = input.liveFetch ?? defaultFetch

  return async (request: Request) => {
    if (fallback) return input.fallbackFetch(request)

    const retryRequest = request.clone()
    const response = await liveFetch(request)
    if (response.status === 401 || response.status === 403) {
      fallback = true
      return input.fallbackFetch(retryRequest)
    }

    return response
  }
}

export function createOpencodeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    config = {
      ...config,
      fetch: defaultFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) => rewrite(request, config?.directory))
  client.interceptors.error.use(wrapClientError)
  return new OpencodeClient({ client })
}
