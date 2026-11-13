/** PEM client certificate and private key, with the passphrase of an encrypted key. */
export interface Tls {
  readonly cert: string
  readonly key: string
  readonly passphrase?: string
}

/** The `fetch` and request options that present a client certificate on this runtime. */
export interface Sender {
  readonly fetch: typeof globalThis.fetch
  readonly init: Record<string, unknown>
}
