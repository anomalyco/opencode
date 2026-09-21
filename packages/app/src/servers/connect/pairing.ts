import { Codec } from "@/runtime/persistence/codec"
import { normalizeServerUrl } from "@/runtime/server/registry"

const pairing = Codec.fromJsonString(
  Codec.struct({
    urls: Codec.array(Codec.string),
    username: Codec.literal("opencode"),
    password: Codec.string,
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

export function decodePairingCode(value: string) {
  const result = Codec.decodeOption(pairing, value)
  if (!result) return
  const urls = [...new Set(result.urls.map(serverAddress).filter((url) => url !== undefined))]
  if (!urls.length) return
  return { urls, password: result.password }
}

