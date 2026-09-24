import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { JsonObject, ProviderShared, optionalNull } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const ADAPTER = "meta-images"
const NAME = "Meta Images"
const PROVIDER = ProviderID.make("meta")

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

type OpenString<Known extends string> = Known | (string & {})

/** Provider-native options. Common fields (`n`, `size`, `format`, `images`) live on the request. */
export type ImageOptions = {
  readonly responseFormat?: OpenString<"b64_json" | "url">
  readonly reasoningStrength?: OpenString<"low" | "high">
  readonly toolEnablement?: {
    readonly enable_image_search?: boolean
    readonly enable_web_search?: boolean
    readonly enable_shell?: boolean
  }
  readonly [key: string]: unknown
}

export type Request = ImageRequestFor<ImageOptions>

// ---------------------------------------------------------------------------
// 2. Request body and response schemas
// ---------------------------------------------------------------------------

const Body = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.String,
    prompt: Schema.String,
    images: Schema.optional(Schema.Array(JsonObject)),
    n: Schema.optional(Schema.Number),
    /** Aspect ratio hint, not an exact output resolution. */
    size: Schema.optional(Schema.String),
    output_format: Schema.optional(Schema.String),
    response_format: Schema.optional(Schema.String),
    reasoning_strength: Schema.optional(Schema.String),
    tool_enablement: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  }),
  [JsonObject],
)

const Response = Schema.Struct({
  data: Schema.Array(Schema.Struct({ b64_json: optionalNull(Schema.String), url: optionalNull(Schema.String) })),
  output_format: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      total_tokens: Schema.optional(Schema.Number),
    }),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

// Meta has no file handles: refs are rejected even when they name this provider.
const reference = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, undefined, NAME).pipe(Effect.map((item) => ({ image_url: item.value })))

const fromRequest = Effect.fn("MetaImages.fromRequest")(function* (request: Request) {
  const images = yield* Effect.forEach(request.images ?? [], reference)
  const { responseFormat, reasoningStrength, toolEnablement, ...native } = request.providerOptions ?? {}
  const payload = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Body))(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        images: images.length === 0 ? undefined : images,
        n: request.n,
        size: request.size,
        output_format: request.format,
        response_format: responseFormat,
        reasoning_strength: reasoningStrength,
        tool_enablement: toolEnablement,
      },
      native,
      request.http?.body,
    ),
  )
  return MediaProtocol.json(payload)
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeResponse = Effect.fn("MetaImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.DecodeContext<Request>,
) {
  const output = yield* MediaProtocol.decodeJson(ADAPTER, NAME, Response)(response)
  const decoded = output.value
  const requested = context.body.type === "json" ? context.body.value.output_format : undefined
  const format = decoded.output_format ?? (typeof requested === "string" ? requested : "webp")
  const mediaType = `image/${format}`
  const images = yield* Effect.forEach(decoded.data, (item, index) => {
    if (item.b64_json)
      return MediaInput.decodedAsset(output.invalid, `${NAME} result ${index}`, item.b64_json, mediaType, {
        info: { format },
      })
    if (item.url) return Effect.succeed(Media.url(item.url, { mediaType, info: { format } }))
    return Effect.fail(output.invalid(`${NAME} result ${index} has neither image data nor a URL`))
  })
  if (images.length === 0) return yield* output.invalid(`${NAME} returned no images`)
  return new ImageResponse({
    images,
    usage:
      decoded.usage === undefined
        ? undefined
        : {
            type: "tokens",
            input: decoded.usage.input_tokens,
            output: decoded.usage.output_tokens,
            total: decoded.usage.total_tokens,
            details: { meta: decoded.usage },
          },
    providerMetadata: { meta: { outputFormat: format } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["mask", "aspectRatio", "seed"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput & { readonly baseURL: string }) =>
  ImageModel.fromRoute<ImageOptions>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      path: ({ request }) => `/images/${isEdit(request) ? "edits" : "generations"}`,
    },
    input,
  )

export * as MetaImages from "./meta-images.js"
