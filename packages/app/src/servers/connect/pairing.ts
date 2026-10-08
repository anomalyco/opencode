import { isUnauthorizedError, OpenCode } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { checkServerHealth } from "@/runtime/server/health"
import { normalizeServerUrl } from "@/runtime/server/registry"

export function serverAddress(value: string) {
  if (value.includes("://") && !/^https?:\/\//.test(value.trim())) return
  const normalized = normalizeServerUrl(value)

  if (!normalized || !URL.canParse(normalized)) return
  const url = new URL(normalized)

  if (url.protocol !== "http:" && url.protocol !== "https:") return

  if (url.username || url.password || url.search || url.hash) return

  return normalized
}

const CODE = /^[A-Za-z0-9_-]+$/

const decodePayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String, urls: Schema.Array(Schema.String) })),
)

// `opencode pair` prints links carrying a single-use code that the server exchanges for a session token.
// Its QR code carries the same code with every reachable server address as {"code","urls"} JSON.
export function pairingLink(value: string) {
  const trimmed = value.trim()

  if (trimmed.startsWith("{")) {
    const payload = Option.getOrUndefined(decodePayload(trimmed))

    if (!payload || !CODE.test(payload.code)) return
    const urls = [...new Set(payload.urls)].map(serverAddress)

    if (urls.length === 0 || urls.some((url) => url === undefined)) return

    return { urls: urls.filter((url) => url !== undefined), code: payload.code }
  }

  const url = URL.parse(trimmed)

  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return
  const code = /^\/auth\/connect\/([^/]+)$/.exec(url.pathname)?.[1]
  const address = serverAddress(url.origin)

  if (!code || !CODE.test(code) || !address) return

  return { urls: [address], code }
}

// A server address typed where a pairing link was expected: a host with no path, so a bare code or a cut-off link
// is not mistaken for a server. Paths stay allowed in the password form, where servers behind a proxy prefix live.
export function bareServerAddress(value: string) {
  const address = serverAddress(value)

  if (!address) return
  const url = new URL(address)

  if (url.pathname !== "/") return

  if (url.hostname !== "localhost" && !url.hostname.includes(".") && !url.hostname.startsWith("[") && !url.port) return

  return address
}

// Servers before one-time links paired with `/connect#<credentials>` or `/connect?data=<credentials>`.
export function legacyPairingLink(value: string) {
  const url = URL.parse(value.trim())

  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return false

  return url.pathname === "/connect" && (url.hash.length > 1 || url.searchParams.has("data"))
}

export type Pairing = { readonly url: string; readonly password: string }

export type Redeemed =
  | { readonly type: "paired"; readonly pairing: Pairing }
  | { readonly type: "expired" }
  | { readonly type: "unreachable" }

// Every address may reach the same server, but the code is single-use, so at most one attempt succeeds.
export function redeemPairingLink(link: { urls: ReadonlyArray<string>; code: string }) {
  const attempts = link.urls.map((url) =>
    OpenCode.make({ baseUrl: url })
      .server.connect({ code: link.code }, { signal: AbortSignal.timeout(5_000) })
      .then((session): Pairing => ({ url, password: session.token })),
  )

  // Whether the first address answered at all: a 401 there means another address spent the code first.
  const first = attempts[0]?.then(
    () => true,
    (error) => isUnauthorizedError(error),
  )

  return Promise.any(attempts)
    .then((pairing) => preferFirst(link.urls, pairing, first))
    .then(
      (pairing): Redeemed => ({ type: "paired", pairing }),
      // Only a server's answer proves the code is spent; addresses that could not be reached leave it valid.
      (error): Redeemed =>
        error instanceof AggregateError && error.errors.some(isUnauthorizedError)
          ? { type: "expired" }
          : { type: "unreachable" },
    )
}

// The token works on every address of the server, so keep the first one (the address the user chose in Pairing) when it
// answers, even if a nearer address answered sooner: a local network address stops working away from that network. An
// address that has not answered within a second, such as a local one seen from elsewhere, is not waited for.
async function preferFirst(
  urls: ReadonlyArray<string>,
  pairing: Pairing,
  answered: Promise<boolean> | undefined,
): Promise<Pairing> {
  const first = urls[0]

  if (!first || first === pairing.url || !answered) return pairing

  const reachable = await Promise.race([
    answered,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ])

  if (!reachable) return pairing
  const http = { url: first, password: pairing.password }
  const health = await checkServerHealth(http, globalThis.fetch, { signal: AbortSignal.timeout(5_000), retryCount: 0 })

  return health.healthy ? http : pairing
}
