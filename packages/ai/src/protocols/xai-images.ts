import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { JsonObject, ProviderShared, lenient, optionalNull } from "./shared.js"
import { ImageSizing } from "./utils/image-sizing.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "xai-images", name: "xAI Images", provider: "xai" })
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Provider-native options. Common fields (`n`, `aspect`, `resolution`, `images`) live on the request. */
export type XAIImageOptions = {
  readonly responseFormat?: OpenString<"url" | "b64_json">
  readonly response_format?: OpenString<"url" | "b64_json">
} & Record<string, unknown>

export type Request = ImageRequestFor<XAIImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const XAIImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: optionalNull(Schema.String),
      url: optionalNull(Schema.String),
      revised_prompt: optionalNull(Schema.String),
      mime_type: optionalNull(Schema.String),
    }),
  ),
  usage: lenient(JsonObject),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const nativeOptions = (options: XAIImageOptions | undefined) => {
  if (!options) return undefined
  const { responseFormat, ...native } = options
  return { response_format: responseFormat, ...native }
}

/** xAI renders `1k` or `2k`; other tiers use the nearest one. */
const resolution = (request: Request) => {
  if (request.resolution === undefined) return undefined
  return (ImageSizing.tier(request.resolution) ?? 1) < 1.5 ? "1k" : "2k"
}

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

const reference = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, route.provider, route.name).pipe(
    Effect.map((item) =>
      item.type === "ref" ? { file_id: item.value } : { url: item.value, type: "image_url" as const },
    ),
  )

const fromRequest = Effect.fn("XAIImages.fromRequest")(function* (request: Request) {
  const references = yield* Effect.forEach(request.images ?? [], reference)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        // xAI takes one edit source as `image` and several as `images`.
        image: references.length === 1 ? references[0] : undefined,
        images: references.length > 1 ? references : undefined,
        n: request.n,
        aspect_ratio: request.aspect,
        resolution: resolution(request),
      },
      nativeOptions(request.providerOptions),
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(XAIImageResponse)

const decodeResponse = Effect.fn("XAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.DecodeContext<Request>,
) {
  const output = yield* decodeDocument(response)
  const decoded = output.value
  const requested = context.request.resolution
  const used = resolution(context.request)
  const images = yield* Effect.forEach(decoded.data, (item, index) =>
    MediaInput.imageOutput(output.invalid, `${route.name} result ${index}`, item, item.mime_type ?? undefined, {
      providerMetadata:
        item.revised_prompt === undefined || item.revised_prompt === null
          ? undefined
          : { xai: { revisedPrompt: item.revised_prompt } },
    }),
  )
  if (images.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  // xAI reports a USD cost (`cost_in_usd_ticks`) rather than tokens, seconds, or credits; the raw record stays in
  // provider metadata.
  return new ImageResponse({
    images,
    notices:
      requested === undefined || requested.toLowerCase() === used
        ? undefined
        : [{ type: "other", message: `${route.name} doesn't offer ${requested}; used ${used}` }],
    providerMetadata: decoded.usage === undefined ? undefined : { xai: { usage: decoded.usage } },
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
  ImageModel.fromRoute<XAIImageOptions>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: ({ request }) => (isEdit(request) ? EDIT_PATH : PATH) },
    input,
  )

export const XAIImages = {
  protocol,
  model,
} as const
