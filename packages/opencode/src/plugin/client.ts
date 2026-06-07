import { createOpencodeClient } from "@opencode-ai/sdk"
import { ServerAuth } from "@/server/auth"

const liveServerReachable = new Map<string, boolean>()
type ClientFetch = (request: Request) => Promise<Response>

function normalizeServerUrl(serverUrl: URL) {
  return serverUrl.toString()
}

async function probeServerReachable(serverUrl: URL, timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await globalThis.fetch(new URL("/session", serverUrl), {
      method: "GET",
      headers: ServerAuth.headers(),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function useLiveServer(serverUrl: URL) {
  const key = normalizeServerUrl(serverUrl)
  const cached = liveServerReachable.get(key)
  if (cached !== undefined) return cached
  const reachable = await probeServerReachable(serverUrl)
  liveServerReachable.set(key, reachable)
  return reachable
}

function rewriteRequest(request: Request, serverUrl: URL) {
  const url = new URL(request.url)
  return new Request(new URL(`${url.pathname}${url.search}`, serverUrl), request)
}

export function createPluginClient(input: {
  directory: string
  getServerUrl: () => URL
  fallbackFetch: ClientFetch
}) {
  return createOpencodeClient({
    baseUrl: "http://localhost",
    directory: input.directory,
    headers: ServerAuth.headers(),
    fetch: createPluginFetch(input),
  })
}

export function createPluginFetch(input: { getServerUrl: () => URL; fallbackFetch: ClientFetch }): ClientFetch {
  return async (request: Request) => {
    const serverUrl = input.getServerUrl()
    if (await useLiveServer(serverUrl)) {
      const key = normalizeServerUrl(serverUrl)
      const fallbackRequest = request.clone()
      try {
        const response = await globalThis.fetch(rewriteRequest(request, serverUrl))
        if (response.status === 401 || response.status === 403) {
          liveServerReachable.set(key, false)
          return input.fallbackFetch(fallbackRequest)
        }
        return response
      } catch {
        liveServerReachable.set(key, false)
        return input.fallbackFetch(fallbackRequest)
      }
    }
    return input.fallbackFetch(request)
  }
}

export function resetPluginClientReachabilityForTests() {
  liveServerReachable.clear()
}
