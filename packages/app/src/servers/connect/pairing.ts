import { OpenCode } from "@opencode/client/promise"
import { Option, Schema } from "effect"
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

export type Pairing = { readonly url: string; readonly password: string }

// Every address may reach the same server, but the code is single-use, so at most one attempt succeeds.
export function redeemPairingLink(link: { urls: ReadonlyArray<string>; code: string }) {
  return Promise.any(
    link.urls.map((url) =>
      OpenCode.make({ baseUrl: url })
        .server.connect({ code: link.code }, { signal: AbortSignal.timeout(5_000) })
        .then((session): Pairing => ({ url, password: session.token })),
    ),
  ).catch(() => undefined)
}
