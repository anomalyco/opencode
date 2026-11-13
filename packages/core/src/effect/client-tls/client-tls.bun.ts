import type { Sender, Tls } from "./client-tls.js"

// Bun's fetch takes the client certificate per request.
export function sender(tls: Tls): Sender | undefined {
  return { fetch: globalThis.fetch, init: { tls } }
}

export * as ClientTls from "./client-tls.bun.js"
