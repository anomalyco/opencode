export * as SidecarCredentials from "./sidecar-credentials"

import type { ServerReadyData } from "../../shared/ipc-contract"

export type Data = ServerReadyData & { password: string | null }

// The renderer talks to the sidecar without an Authorization header; the main process adds it from
// here so GET requests stay CORS-simple and skip the preflight round trip. Both the initial connection
// and every reconnect publish the current endpoint.
let current: Data | undefined

const listeners = new Set<() => void>()

export function set(data: Data) {
  current = data
  listeners.forEach((listener) => listener())
}

export function get() {
  return current
}

/** Runs `listener` after each `set`: the first connection and every reconnect. Returns a function that stops it. */
export function onChange(listener: () => void) {
  listeners.add(listener)

  return () => void listeners.delete(listener)
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
