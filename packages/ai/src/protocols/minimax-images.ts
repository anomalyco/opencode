import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { AIError, QuotaExceededError, mergeJsonRecords, type OpenString } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { ImageSizing } from "./utils/image-sizing.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "minimax-images", name: "MiniMax Images", provider: "minimax" })
export const DEFAULT_BASE_URL = "https://api.minimax.io/v1"
export const PATH = "/image_generation"
const OUTPUT_RETENTION = Duration.hours(24)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common `aspect` and `resolution` lower to `aspect_ratio` or `width` and `height`. */
export type MiniMaxImageOptions = {
  /** Defaults to `base64`, which returns the bytes inline; `url` links expire after 24 hours. */
  readonly responseFormat?: OpenString<"url" | "base64">
  readonly seed?: number
  readonly promptOptimizer?: boolean
  /** Native preset; it replaces `aspect` and `resolution`. */
  readonly aspect_ratio?: string
  /** Native size, 512 to 2048 in steps of 8 (`image-01` only); it replaces `aspect` and `resolution`. */
  readonly width?: number
  readonly height?: number
} & Record<string, unknown>

export type Request = ImageRequestFor<MiniMaxImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const MiniMaxImageResponse = Schema.Struct({
  id: optionalNull(Schema.String),
  data: optionalNull(
    Schema.Struct({
      image_urls: optionalNull(Schema.Array(Schema.String)),
      image_base64: optionalNull(Schema.Array(Schema.String)),
    }),
  ),
  metadata: optionalNull(
    Schema.Struct({
      success_count: optionalNull(Schema.Union([Schema.Number, Schema.String])),
      failed_count: optionalNull(Schema.Union([Schema.Number, Schema.String])),
    }),
  ),
  base_resp: optionalNull(
    Schema.Struct({
      status_code: Schema.Number,
      status_msg: optionalNull(Schema.String),
    }),
  ),
})

const FAILURE: Readonly<Record<string, MediaProtocol.Failure>> = {
  1002: "RateLimit",
  1004: "Authentication",
  2013: "InvalidRequest",
  2049: "Authentication",
}
const INSUFFICIENT_BALANCE = 1008
const CONTENT_POLICY = 1026

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** MiniMax's `aspect_ratio` presets and the sizes it renders them at. */
const PRESETS: Record<string, ImageSizing.Size> = {
  "1:1": { width: 1024, height: 1024 },
  "16:9": { width: 1280, height: 720 },
  "4:3": { width: 1152, height: 864 },
  "3:2": { width: 1248, height: 832 },
  "2:3": { width: 832, height: 1248 },
  "3:4": { width: 864, height: 1152 },
  "9:16": { width: 720, height: 1280 },
  "21:9": { width: 1344, height: 576 },
}

const LIMITS = { multiple: 8, minEdge: 512, maxEdge: 2048 }

const nativeOptions = (options: MiniMaxImageOptions = {}) => {
  const { responseFormat, promptOptimizer, ...native } = options
  return { response_format: responseFormat ?? "base64", prompt_optimizer: promptOptimizer, ...native }
}

/** `image-01-live` rejects `21:9`. */
const presets = (model: string) =>
  model === "image-01" ? PRESETS : Object.fromEntries(Object.entries(PRESETS).filter(([key]) => key !== "21:9"))

/** Presets render at about 1K, so they serve a preset aspect with no resolution or `1K`. */
const preset = (request: Request) => {
  const aspect = request.aspect ?? "1:1"
  if (!Object.hasOwn(presets(request.model.id), aspect)) return undefined
  if (request.resolution !== undefined && ImageSizing.tier(request.resolution) !== 1) return undefined
  return aspect
}

/** Only `image-01` takes free `width` and `height`; other models render the presets alone. */
const sizing = (request: Request) => {
  if (!ImageSizing.isRequested(request)) return Effect.succeed({})
  const aspect = preset(request)
  if (aspect !== undefined) return Effect.succeed({ aspect_ratio: aspect })
  if (request.model.id === "image-01") return ImageSizing.exact(route, request, LIMITS)
  const available = presets(request.model.id)
  const closest = ImageSizing.nearest(request, Object.values(available))
  const name = Object.keys(available).find((key) => available[key] === closest)
  return Effect.fail(
    route.unsupported(
      request.resolution === undefined ? "media.aspect" : "media.resolution",
      `${request.model.id} can't render ${[request.aspect, request.resolution].filter((value) => value !== undefined).join(" at ")}; the closest size it takes is ${closest.width}x${closest.height} (${name}). Change aspect or resolution, or set aspect_ratio in providerOptions`,
    ),
  )
}

const isNativeSize = (options: MiniMaxImageOptions | undefined) =>
  options?.aspect_ratio !== undefined || options?.width !== undefined || options?.height !== undefined

// The API only takes a `character` (portrait) subject, one per request.
const subject = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, undefined, `${route.name} input`).pipe(
    Effect.map((item) => ({ type: "character", image_file: item.value })),
  )

const fromRequest = Effect.fn("MiniMaxImages.fromRequest")(function* (request: Request) {
  if ((request.images?.length ?? 0) > 1)
    return yield* route.unsupported("media.images", `${route.name} takes one subject reference image`)
  if (isNativeSize(request.providerOptions) && ImageSizing.isRequested(request))
    return yield* ProviderShared.invalidRequest(
      "MiniMax providerOptions aspect_ratio, width and height replace aspect and resolution; set one or the other",
    )
  const references = yield* Effect.forEach(request.images ?? [], subject)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        subject_reference: references.length === 0 ? undefined : references,
        n: request.n,
        ...(yield* sizing(request)),
      },
      nativeOptions(request.providerOptions),
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(MiniMaxImageResponse)

const decodeResponse = Effect.fn("MiniMaxImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const decoded = output.value
  // MiniMax answers errors with HTTP 200 and a non-zero `base_resp.status_code`.
  const status = decoded.base_resp
  if (status && status.status_code !== 0) {
    const message = `${route.name} failed (${status.status_code}): ${status.status_msg ?? "unknown error"}`
    if (status.status_code === CONTENT_POLICY) return yield* output.contentPolicy(message)
    if (status.status_code === INSUFFICIENT_BALANCE)
      return yield* new AIError({ reason: new QuotaExceededError({ message, body: output.body, http: output.http }) })
    return yield* output.ended("failed", message, MediaProtocol.failure(FAILURE, status.status_code))
  }
  const images = [
    ...(yield* Effect.forEach(decoded.data?.image_base64 ?? [], (data, index) =>
      MediaInput.decodedAsset(output.invalid, `${route.name} result ${index}`, data, undefined),
    )),
    // MiniMax returns no content type for URLs; the media type resolves when the asset is materialized.
    ...(yield* Effect.forEach(decoded.data?.image_urls ?? [], (url) =>
      MediaProtocol.expiringUrl(url, OUTPUT_RETENTION),
    )),
  ]
  const failed = Number(decoded.metadata?.failed_count ?? 0)
  if (images.length === 0 && failed > 0)
    return yield* output.contentPolicy(`${route.name} blocked ${failed} image(s) for content safety`)
  if (images.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  return new ImageResponse({
    images,
    providerMetadata: {
      minimax: {
        id: decoded.id ?? undefined,
        successCount: decoded.metadata?.success_count ?? undefined,
        failedCount: decoded.metadata?.failed_count ?? undefined,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>(route, {
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<MiniMaxImageOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const MiniMaxImages = {
  protocol,
  model,
} as const
