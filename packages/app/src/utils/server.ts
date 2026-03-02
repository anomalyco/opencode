import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const isSameOrigin = new URL(server.url, window.location.href).origin === window.location.origin

  const auth = (() => {
    if (isSameOrigin || !server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`,
    }
  })()

  const baseFetch = config.fetch ?? ((req: Request) => fetch(req))

  const wrappedFetch = async (req: Request) => {
    const response = await baseFetch(req)
    if (isSameOrigin && response.status === 401 && window.location.pathname !== "/login") {
      window.location.href = "/login?redirect=" + encodeURIComponent(window.location.pathname + window.location.search)
    }
    return response
  }

  return createOpencodeClient({
    ...config,
    fetch: wrappedFetch as typeof fetch,
    credentials: isSameOrigin ? "include" : "same-origin",
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
