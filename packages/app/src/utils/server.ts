import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "./base64"

function absolute(dir: string) {
  return dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir) || dir.startsWith("\\\\")
}

export function normalizeDirectory(dir?: string) {
  if (!dir || absolute(dir)) return dir
  const next = decode64(dir)
  if (!next || !absolute(next)) return dir
  return next
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    directory: normalizeDirectory(config.directory),
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
