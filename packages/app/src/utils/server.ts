import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export function createSdkForServer({
  server,
  authToken,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
  authToken?: string | null
}) {
  const basicAuth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`,
    }
  })()

  const bearerAuth = (() => {
    if (!authToken) return
    return {
      Authorization: `Bearer ${authToken}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: { ...config.headers, ...basicAuth, ...bearerAuth },
    baseUrl: server.url,
  })
}
