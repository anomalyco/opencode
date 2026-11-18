import { tlsFallbackFetch } from "@opencode/util/tls-fallback"
import type { Sender, Tls } from "./client-tls.js"

// These requests skip the shared fetch, so they need its handshake fallback here.
const fetch = tlsFallbackFetch() as typeof globalThis.fetch

// Bun's fetch takes the client certificate per request.
export function sender(tls: Tls): Sender | undefined {
  return { fetch, init: { tls } }
}

export * as ClientTls from "./client-tls.bun.js"
