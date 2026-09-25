import { Effect, Encoding } from "effect"
import { Media } from "../../media.js"
import type { MediaProtocol } from "../../route/media-protocol.js"
import { mergeJsonRecords, type AIError, type ProviderID } from "../../schema/index.js"
import { encodeJson } from "../../utils/json.js"
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

export const dimensions = (size: string) => {
  const [width, height] = size.split("x").map(Number)
  return { width, height }
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

/** One image of an OpenAI-shaped `data` array, which carries either `b64_json` or a `url`. */
export const imageOutput = (
  invalid: (message: string, cause?: unknown) => AIError,
  label: string,
  item: { readonly b64_json?: string | null; readonly url?: string | null },
  mediaType: string | undefined,
  options?: Media.AssetOptions,
) => {
  if (item.b64_json) return decodedAsset(invalid, label, item.b64_json, mediaType, options)
  if (item.url) return Effect.succeed(Media.url(item.url, { ...options, mediaType }))
  return Effect.fail(invalid(`${label} has neither image data nor a URL`))
}

/**
 * Append multipart text fields: strings as-is, other values as JSON, or arrays as repeated `key[]` parts with
 * `repeatArrays`. `overlay` keys in `reserved` are dropped so `http.body` cannot replace route-owned fields.
 */
export const appendFields = (
  form: FormData,
  fields: Record<string, unknown>,
  options: {
    readonly overlay?: Record<string, unknown>
    readonly reserved: ReadonlySet<string>
    readonly repeatArrays?: true
  },
) => {
  const overlay = Object.entries(options.overlay ?? {}).filter(([key]) => !options.reserved.has(key))
  Object.entries(mergeJsonRecords(fields, Object.fromEntries(overlay)) ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value) && options.repeatArrays)
      return value.forEach((item) => form.append(`${key}[]`, String(item)))
    form.append(key, typeof value === "string" ? value : encodeJson(value))
  })
}

export * as MediaInput from "./media-input.js"
