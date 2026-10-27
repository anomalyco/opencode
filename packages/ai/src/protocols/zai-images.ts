import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { ImageSizing } from "./utils/image-sizing.js"

const route = MediaProtocol.identity({ id: "zai-images", name: "Z.ai Images", provider: "zai" })
export const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4"
export const PATH = "/images/generations"
const OUTPUT_RETENTION = Duration.days(30)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common `aspect` and `resolution` lower to `size`. */
export type ZAIImageOptions = {
  /** Exact `WIDTHxHEIGHT`; it wins over `aspect` and `resolution`. */
  readonly size?: string
  readonly quality?: OpenString<"hd" | "standard">
  readonly userID?: string
} & Record<string, unknown>

export type Request = ImageRequestFor<ZAIImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const ZAIImageResponse = Schema.Struct({
  created: Schema.optional(Schema.Int),
  id: Schema.optional(Schema.String),
  request_id: Schema.optional(Schema.String),
  data: Schema.Array(Schema.Struct({ url: Schema.String })),
  content_filter: Schema.optional(
    Schema.Array(
      Schema.Struct({
        role: Schema.optional(Schema.String),
        level: Schema.optional(Schema.Number),
      }),
    ),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const nativeOptions = (options: ZAIImageOptions | undefined) => {
  if (!options) return undefined
  const { userID, ...native } = options
  return { user_id: userID, ...native }
}

/** GLM-Image takes 1024–2048 px edges in steps of 32; CogView takes 512–2048 px in steps of 16. */
const limits = (model: string) =>
  model.startsWith("glm-image")
    ? { multiple: 32, minEdge: 1024, maxEdge: 2048, maxPixels: 2 ** 22 }
    : { multiple: 16, minEdge: 512, maxEdge: 2048, maxPixels: 2 ** 21 }

const fromRequest = Effect.fn("ZAIImages.fromRequest")(function* (request: Request) {
  const size = yield* ImageSizing.exact(route, request, limits(request.model.id))
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        size: size === undefined ? undefined : `${size.width}x${size.height}`,
      },
      nativeOptions(request.providerOptions),
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(ZAIImageResponse)

const decodeResponse = Effect.fn("ZAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const decoded = output.value
  if (decoded.data.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  return new ImageResponse({
    // Z.ai returns only URLs and no content type; the media type resolves when the asset is materialized.
    images: yield* Effect.forEach(decoded.data, (item) => MediaProtocol.expiringUrl(item.url, OUTPUT_RETENTION)),
    providerMetadata: {
      zai: {
        created: decoded.created,
        id: decoded.id,
        requestID: decoded.request_id,
        contentFilter: decoded.content_filter,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>(route, {
  unsupported: ["images", "n"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<ZAIImageOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const ZAIImages = {
  protocol,
  model,
} as const
