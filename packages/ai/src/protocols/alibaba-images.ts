import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { JsonObject, ProviderShared, lenient } from "./shared.js"
import { ImageSizing } from "./utils/image-sizing.js"

const route = MediaProtocol.identity({ id: "alibaba-images", name: "Alibaba Images", provider: "alibaba" })
export const PATH = "/services/aigc/multimodal-generation/generation"
const OUTPUT_RETENTION = Duration.hours(24)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native `parameters`. Common fields (`n`, `aspect`, `resolution`, `images`) live on the request. */
export type AlibabaImageOptions = {
  /** Exact `WIDTH*HEIGHT`; it wins over `aspect` and `resolution`. */
  readonly size?: string
  readonly seed?: number
  readonly negativePrompt?: string
  readonly promptExtend?: boolean
  readonly watermark?: boolean
  readonly thinkingMode?: boolean
  readonly enableSequential?: boolean
} & Record<string, unknown>

export type Request = ImageRequestFor<AlibabaImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const AlibabaImageResponse = Schema.Struct({
  output: Schema.Struct({
    choices: Schema.Array(
      Schema.Struct({
        message: Schema.Struct({
          content: Schema.Array(Schema.Struct({ image: Schema.optional(Schema.String) })),
        }),
      }),
    ),
  }),
  usage: lenient(JsonObject),
  request_id: Schema.optional(Schema.String),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const nativeOptions = (options: AlibabaImageOptions | undefined) => {
  if (!options) return undefined
  const { negativePrompt, promptExtend, thinkingMode, enableSequential, ...native } = options
  return {
    negative_prompt: negativePrompt,
    prompt_extend: promptExtend,
    thinking_mode: thinkingMode,
    enable_sequential: enableSequential,
    ...native,
  }
}

const fromRequest = Effect.fn("AlibabaImages.fromRequest")(function* (request: Request) {
  const images = yield* Effect.forEach(request.images ?? [], (image) =>
    ProviderShared.mediaReference(image, undefined, `${route.name} input`).pipe(
      Effect.map((item) => ({ image: item.value })),
    ),
  )
  const size = yield* ImageSizing.exact(route, request, { multiple: 16, minPixels: 512 * 512, maxPixels: 2048 * 2048 })
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        input: { messages: [{ role: "user", content: [...images, { text: request.prompt }] }] },
        parameters: mergeJsonRecords(
          { size: size === undefined ? undefined : `${size.width}*${size.height}`, n: request.n },
          nativeOptions(request.providerOptions),
        ),
      },
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(AlibabaImageResponse)

const decodeResponse = Effect.fn("AlibabaImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const decoded = output.value
  // Qwen-Image returns every image in one choice; Wan returns one choice per image.
  const urls = decoded.output.choices.flatMap((choice) =>
    choice.message.content.flatMap((item) => (item.image === undefined ? [] : [item.image])),
  )
  if (urls.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  // Model Studio bills per image; its token counts are informational, so the raw record stays in provider metadata.
  return new ImageResponse({
    images: yield* Effect.forEach(urls, (url) => MediaProtocol.expiringUrl(url, OUTPUT_RETENTION)),
    providerMetadata: { alibaba: { requestID: decoded.request_id, usage: decoded.usage } },
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
  ImageModel.fromRoute<AlibabaImageOptions>({ protocol, path: PATH }, input)

export const AlibabaImages = {
  protocol,
  model,
} as const
