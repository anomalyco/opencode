export * as SidecarCredentials from "./sidecar-credentials"

import type { ServerReadyData } from "../../shared/ipc-contract"

export type Data = ServerReadyData & { password: string | null }

// The renderer talks to the sidecar without an Authorization header; the main process adds it from
// here so GET requests stay CORS-simple and skip the preflight round trip. Both the initial connection
// and every reconnect publish the current endpoint.
let current: Data | undefined

export function set(data: Data) {
  current = data
}

export function get() {
  return current
}

/** What the renderer learns about the sidecar: its origin, never its credential. */
export function ready(data: Data): ServerReadyData {
  return { url: data.url }
}

/** The Basic credential for a request to the sidecar origin, or undefined for any other URL. */
export function authorization(sidecar: Data | undefined, url: string) {
  if (!sidecar?.password || !URL.canParse(url)) return
  if (new URL(url).origin !== sidecar.url) return
  return `Basic ${Buffer.from(`opencode:${sidecar.password}`).toString("base64")}`
}
