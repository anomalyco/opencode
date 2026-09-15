import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

// Cold-start Chromium network-service init (e.g. enumerating a large corporate CA store) can
// stall a renderer's first fetch to the local sidecar for 15-20s+ even though the server itself
// answers instantly — measured 19.5s on a locked-down corporate machine. A short timeout here
// falsely triggers the "v2" default before the real (v1) health check ever completes. 60s matches
// the sidecar's own SIDECAR_START_STALL_TIMEOUT in server.ts.
async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}
