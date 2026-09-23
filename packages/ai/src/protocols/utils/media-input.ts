import { Effect, Encoding } from "effect"
import { Media } from "../../media.js"
import type { MediaProtocol } from "../../route/media-protocol.js"
import type { AIError, ProviderID } from "../../schema/index.js"
import { ProviderShared } from "../shared.js"

/** Owned bytes for multipart uploads; decodes `base64` sources and rejects remote sources. */
export const inlineBytes = (route: string, asset: Media.Asset): Effect.Effect<Uint8Array, AIError> => {
  if (asset.source.type === "bytes") return Effect.succeed(asset.source.data)
  const inline = asset.inline()
  if (!inline) return Effect.fail(ProviderShared.inlineRequired(route, asset))
  return Effect.fromResult(Encoding.decodeBase64(inline.base64)).pipe(
    Effect.mapError((cause) => ProviderShared.invalidRequest(`${route} media contains invalid base64 data`, cause)),
  )
}

/** Copied because `BlobPart` requires a plain `ArrayBuffer`. */
export const blob = (data: Uint8Array, mediaType: string) => {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new Blob([buffer], { type: mediaType })
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"

export const query = (route: string, values: Record<string, unknown>): Effect.Effect<MediaProtocol.Query, AIError> => {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined)
  const invalid = entries.find(([, value]) => !isScalar(value) && !(Array.isArray(value) && value.every(isScalar)))
  if (invalid !== undefined)
    return Effect.fail(ProviderShared.invalidRequest(`${route} cannot send "${invalid[0]}" as a query parameter`))
  return Effect.succeed(
    Object.fromEntries(entries.map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])),
  )
}

/** Provider file handle when the ref belongs to this provider; refs from other providers are never forwarded. */
export const refID = (asset: Media.Asset, provider: ProviderID) =>
  asset.source.type === "ref" && asset.source.provider === provider ? asset.source.id : undefined

/** Decode a provider's base64 output once into an owned `bytes` asset, sniffing the type when it is not declared. */
export const decodedAsset = (
  invalid: (message: string, cause?: unknown) => AIError,
  label: string,
  data: string,
  mediaType: string | undefined,
  options?: Media.AssetOptions,
) =>
  Effect.fromResult(Encoding.decodeBase64(data)).pipe(
    Effect.mapError((cause) => invalid(`${label} contains invalid base64 data`, cause)),
    Effect.map((bytes) => Media.bytes(bytes, mediaType, options)),
  )

export * as MediaInput from "./media-input.js"
