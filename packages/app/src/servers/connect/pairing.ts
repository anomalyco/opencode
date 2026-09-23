import { Option, Schema } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { normalizeServerUrl } from "@/runtime/server/registry"

const pairing = Schema.fromJsonString(
  Schema.Struct({
    urls: Schema.optional(Schema.Array(Schema.String)),
    username: Schema.Literal("opencode"),
    password: Schema.String,
  }),
)

export function serverAddress(value: string) {
  if (value.includes("://") && !/^https?:\/\//.test(value.trim())) return
  const normalized = normalizeServerUrl(value)
  if (!normalized || !URL.canParse(normalized)) return
  const url = new URL(normalized)
  if (url.protocol !== "http:" && url.protocol !== "https:") return
  if (url.username || url.password || url.search || url.hash) return
  return normalized
}

export function decodePairingCode(value: string, origin?: string) {
  const result = Schema.decodeUnknownOption(pairing)(value)
  if (Option.isNone(result)) return
  const urls = [
    ...new Set((result.value.urls ?? (origin ? [origin] : [])).map(serverAddress).filter((url) => url !== undefined)),
  ]
  if (!urls.length) return
  return { urls, password: result.value.password }
}

export function pairingUrl(value: { username: "opencode"; password: string }, host: string) {
  return `${new URL("/connect", host)}#${base64Encode(JSON.stringify(value))}`
}

// Scanned codes are either the raw pairing JSON or a full /connect URL from `opencode pair` or desktop.
export function decodePairingScan(value: string) {
  const url = URL.parse(value.trim())
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return decodePairingCode(value)
  return decodePairingUrl(url.search, url.origin) ?? decodePairingUrl(url.hash, url.origin)
}

export function decodePairingUrl(value: string, origin?: string) {
  if (value.startsWith("?")) {
    const data = new URLSearchParams(value).get("data")
    return data === null ? undefined : decodePairingCode(data, origin)
  }
  const encoded = value.startsWith("#") ? value.slice(1) : value
  if (!encoded) return
  const legacy = new URLSearchParams(`value=${encoded}`).get("value") ?? ""
  if (legacy.startsWith("{")) return decodePairingCode(legacy)
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return
  const binary = atob(
    encoded
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "="),
  )
  return decodePairingCode(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))), origin)
}
