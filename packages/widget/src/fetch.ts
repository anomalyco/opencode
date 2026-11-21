import type { Capabilities } from "./widget-template.js"

/** What `widget.fetch` hands the host (`__host.fetch(request)`). */
export interface FetchRequest {
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

/** What `__host.fetch` resolves with: text bodies as `body`, anything else base64 in `body64`. */
export type FetchResponse = {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
} & ({ readonly body: string } | { readonly body64: string })

export type FetchErrorKind = "CapabilityDenied" | "Network" | "Timeout" | "TooLarge" | "RateLimited"

/** How `__host.fetch` rejects; the program catches exactly this object. */
export interface FetchError {
  readonly kind: FetchErrorKind
  readonly message: string
}

/** One HTTP exchange without following redirects; headers with lowercase names. Rejects on network failure. */
export type Transport = (
  request: FetchRequest,
  signal: AbortSignal,
) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }>

export const FETCH_LIMITS = {
  requestBytes: 256 * 1024,
  responseBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  inFlight: 4,
  perSecond: 10,
  redirects: 5,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
} as const

/**
 * The platform `fetch`, one hop at a time (`redirect: "manual"`), without credentials, reading at most
 * `FETCH_LIMITS.responseBytes`. It can't see the addresses a host name resolves to, so it doesn't stop a public name
 * that points at a private address; native hosts check resolved addresses too.
 */
export const platformTransport: Transport = async (request, signal) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    credentials: "omit",
    signal,
  })
  const chunks: Uint8Array[] = []
  const reader = response.body?.getReader()
  const size = { bytes: 0 }
  while (reader) {
    const chunk = await reader.read()
    if (chunk.done) break
    size.bytes += chunk.value.byteLength
    chunks.push(chunk.value)
    if (size.bytes > FETCH_LIMITS.responseBytes) {
      await reader.cancel()
      break
    }
  }
  return {
    status: response.status,
    headers: Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value])),
    body: Buffer.concat(chunks),
  }
}

/** Why `url` may not be fetched under `capabilities`, if it may not. */
export function denied(url: URL, capabilities: Capabilities | undefined) {
  const hosts = capabilities?.https?.hosts
  if (!hosts) return "This widget template declares no https capability"
  if (url.protocol !== "https:") return `Only https: URLs can be fetched, not ${url.protocol}`
  if (url.username || url.password) return "URLs with credentials can't be fetched"
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (local(host)) return `${host} is a local or private address`
  if (
    !hosts.some(
      (pattern) => pattern === "*" || pattern === host || (pattern.startsWith("*.") && host.endsWith(pattern.slice(1))),
    )
  )
    return `${host} is not in the widget template's https hosts (${hosts.join(", ")})`
}

// Literal localhost, private, loopback, link-local and unspecified addresses.
function local(host: string) {
  if (host === "localhost" || host.endsWith(".localhost")) return true
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (!host.includes(":")) return false
  return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:")
}

/** Text when the body is UTF-8 and the content type isn't a binary one; anything else crosses as base64. */
export function encode(headers: Readonly<Record<string, string>>, body: Uint8Array) {
  const binary = /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|wasm)/i
  const text = binary.test(headers["content-type"] ?? "") ? undefined : utf8(body)
  return text === undefined ? { body64: Buffer.from(body).toString("base64") } : { body: text }
}

function utf8(body: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return undefined
  }
}
