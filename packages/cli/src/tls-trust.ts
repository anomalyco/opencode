export * as TlsTrust from "./tls-trust"

import { X509Certificate } from "node:crypto"
import { getCACertificates, setDefaultCACertificates } from "node:tls"

// Temporary CLI-side mitigation for the October 2026 eMudhra intermediate CA key compromise
// (https://emudhra.we-have-a-problem.com/). Remove this module and the `TlsTrust.install()` call
// in `src/index.ts` once both the bundled runtime store (oven-sh/bun#46159, nodejs/node#66871,
// nodejs/node#66877) and supported OS trust stores no longer trust these roots.
export const DISTRUSTED_CA_FINGERPRINTS: ReadonlySet<string> = new Set([
  // emSign ECC Root CA - G3 (cross-signs emSign Root TLS CA - G3)
  "86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B",
  // AAA Certificate Services (Comodo / Sectigo cross-signer of the 8 compromised intermediates)
  "D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4",
  // emSign Root TLS CA - G3 (direct issuer of the 6 compromised TLS intermediates; in Windows Root Store)
  "7D:D7:8D:5F:4F:13:45:9A:83:DF:F9:AB:BB:A6:2E:DB:AF:6F:2D:10:2B:F2:57:FD:71:2F:4D:9F:27:46:ED:8D",
  // emSign Root CS CA - G3 (direct issuer of the 2 compromised CS intermediates; in Windows Root Store)
  "F2:ED:AA:FF:3D:9B:70:1F:B4:D1:4C:9F:28:5F:8C:0B:AD:90:FC:3B:CC:1F:A0:7D:47:F4:71:8E:DA:BA:34:A5",
  // Additional eMudhra roots removed in NSS 3.131.1, oven-sh/bun#46159, and nodejs/node#66877:
  // emSign Root CA - G1
  "40:F6:AF:03:46:A9:9A:A1:CD:1D:55:5A:4E:9C:CE:62:C7:F9:63:46:03:EE:40:66:15:83:3D:C8:C8:D0:03:67",
  // emSign Root CA - C1
  "12:56:09:AA:30:1D:A0:A2:49:B9:7A:82:39:CB:6A:34:21:6F:44:DC:AC:9F:39:54:B1:42:92:F2:E8:C8:60:8F",
  // emSign ECC Root CA - C3
  "BC:4D:80:9B:15:18:9D:78:DB:3E:1D:8C:F4:F9:72:6A:79:5D:A1:64:3C:A5:F1:35:8E:1D:DB:0E:DC:0D:7E:B3",
])

type FetchInit = BunFetchRequestInit & {
  readonly tls?: BunFetchRequestInit["tls"] & { readonly ca?: unknown }
}

export interface WebSocketClientOptions {
  readonly headers?: Bun.HeadersInit
  readonly protocols?: string | ReadonlyArray<string>
  readonly proxy?: string
  readonly tls?: BunFetchRequestInit["tls"] & { readonly ca?: unknown }
}

export function hasDistrustedCA(
  certificates: ReadonlyArray<string>,
  distrusted: ReadonlySet<string> = DISTRUSTED_CA_FINGERPRINTS,
) {
  return certificates.some((pem) => distrusted.has(new X509Certificate(pem).fingerprint256))
}

export function filterCACertificates(
  certificates: ReadonlyArray<string>,
  distrusted: ReadonlySet<string> = DISTRUSTED_CA_FINGERPRINTS,
) {
  const seen = new Set<string>(distrusted)
  return certificates.filter((pem) => {
    const fingerprint = new X509Certificate(pem).fingerprint256
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function wrapFetch(base: typeof globalThis.fetch, ca: ReadonlyArray<string>): typeof globalThis.fetch {
  const tls = { ca: [...ca] }
  const defaultInit: BunFetchRequestInit = { tls }
  return Object.assign(
    ((input: RequestInfo | URL, init?: FetchInit) => {
      if (!init) return base(input, defaultInit)
      if (!init.tls) return base(input, { ...init, tls })
      if (init.tls.ca !== undefined) return base(input, init)
      return base(input, { ...init, tls: { ...init.tls, ...tls } })
    }) as typeof globalThis.fetch,
    { preconnect: base.preconnect },
  )
}

export function wrapWebSocket(
  Base: typeof globalThis.WebSocket,
  ca: ReadonlyArray<string>,
): typeof globalThis.WebSocket {
  const tls = { ca: [...ca] }
  const defaultOptions = { tls }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Bun extends the WebSocket constructor with a handshake options bag.
  const Native = Base as unknown as new (
    url: string | URL,
    protocolsOrOptions?: string | ReadonlyArray<string> | WebSocketClientOptions,
  ) => globalThis.WebSocket
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Preserves the global WebSocket constructor signature.
  return class WebSocket extends Native {
    constructor(url: string | URL, protocolsOrOptions?: string | ReadonlyArray<string> | WebSocketClientOptions) {
      super(url, webSocketOptions(protocolsOrOptions, tls, defaultOptions))
    }
  } as unknown as typeof globalThis.WebSocket
}

function webSocketOptions(
  input: string | ReadonlyArray<string> | WebSocketClientOptions | undefined,
  tls: { readonly ca: Array<string> },
  defaultOptions: { readonly tls: { readonly ca: Array<string> } },
) {
  if (input === undefined) return defaultOptions
  if (typeof input === "string") return { protocols: [input], tls }
  if (Array.isArray(input)) return { protocols: input, tls }
  if (typeof input !== "object" || input === null) return input
  const options = input as WebSocketClientOptions
  const protocols = typeof options.protocols === "string" ? [options.protocols] : options.protocols
  if (options.tls?.ca !== undefined) return protocols === options.protocols ? options : { ...options, protocols }
  return {
    ...options,
    ...(protocols === options.protocols ? {} : { protocols }),
    tls: options.tls ? { ...options.tls, ...tls } : tls,
  }
}

export function install() {
  const certificates = [...new Set([...getCACertificates("default"), ...getCACertificates("system")])]
  if (!hasDistrustedCA(certificates)) return
  const ca = filterCACertificates(certificates)
  setDefaultCACertificates(ca)
  if (typeof Bun === "undefined") return
  globalThis.fetch = wrapFetch(globalThis.fetch, ca)
  globalThis.WebSocket = wrapWebSocket(globalThis.WebSocket, ca)
}
