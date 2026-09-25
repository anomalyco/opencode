import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"

const route = MediaProtocol.identity({ id: "zai-images", name: "Z.ai Images", provider: "zai" })
export const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4"
export const PATH = "/images/generations"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. The common `size` field lives on the request. */
export type ZAIImageOptions = {
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

const fromRequest = Effect.fn("ZAIImages.fromRequest")(function* (request: Request) {
  return MediaProtocol.json(
    mergeJsonRecords(
      { model: request.model.id, prompt: request.prompt, size: request.size },
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
  const filters = decoded.content_filter ?? []
  return new ImageResponse({
    // Z.ai returns only URLs and no content type; the media type resolves when the asset is materialized.
    images: decoded.data.map((item) => Media.url(item.url)),
    // Z.ai reports applied content filters alongside a successful result; surface them instead of dropping them.
    notices:
      filters.length === 0
        ? undefined
        : filters.map((filter) => ({
            type: "moderated" as const,
            message: `${route.name} applied a content filter${filter.role === undefined ? "" : ` for ${filter.role}`}${
              filter.level === undefined ? "" : ` at level ${filter.level}`
            }`,
            providerMetadata: { zai: filter },
          })),
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
  unsupported: ["images", "mask", "n", "aspectRatio", "seed", "format"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<ZAIImageOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const ZAIImages = {
  protocol,
  model,
} as const
