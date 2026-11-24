import type { Sender, Tls } from "./client-tls.js"

// Workers' fetch can't present a client certificate. Embedders use an mTLS certificate binding's fetch instead.
export function sender(_tls: Tls): Sender | undefined {
  return undefined
}

export * as ClientTls from "./client-tls.workerd.js"
