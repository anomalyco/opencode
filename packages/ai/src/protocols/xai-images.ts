import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const ADAPTER = "xai-images"
const NAME = "xAI Images"
const PROVIDER = ProviderID.make("xai")
export const DEFAULT_BASE_URL = "https://api.x.ai/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type XAIImageString<Known extends string> = Known | (string & {})

/** Provider-native options. Common fields (`n`, `aspectRatio`, `images`) live on the request. */
export type XAIImageOptions = {
  readonly resolution?: XAIImageString<"1k" | "2k">
  readonly responseFormat?: XAIImageString<"url" | "b64_json">
  readonly response_format?: XAIImageString<"url" | "b64_json">
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
  usage: Schema.optional(Schema.Unknown),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const nativeOptions = (options: XAIImageOptions | undefined) => {
  if (!options) return undefined
  const { responseFormat, ...native } = options
  return { response_format: responseFormat, ...native }
}

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

const reference = (asset: Media.Asset) =>
  ProviderShared.mediaReference(asset, PROVIDER, NAME).pipe(
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
        aspect_ratio: request.aspectRatio,
      },
      nativeOptions(request.providerOptions),
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeResponse = Effect.fn("XAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* MediaProtocol.decodeJson(ADAPTER, NAME, XAIImageResponse)(response)
  const decoded = output.value
  const images = yield* Effect.forEach(decoded.data, (item, index) => {
    const providerMetadata =
      item.revised_prompt === undefined || item.revised_prompt === null
        ? undefined
        : { xai: { revisedPrompt: item.revised_prompt } }
    if (item.b64_json)
      return MediaInput.decodedAsset(
        output.invalid,
        `${NAME} result ${index}`,
        item.b64_json,
        item.mime_type ?? undefined,
        {
          providerMetadata,
        },
      )
    if (item.url)
      return Effect.succeed(Media.url(item.url, { mediaType: item.mime_type ?? undefined, providerMetadata }))
    return Effect.fail(output.invalid(`${NAME} result ${index} has neither image data nor a URL`))
  })
  if (images.length === 0) return yield* output.invalid(`${NAME} returned no images`)
  const usage = ProviderShared.isRecord(decoded.usage) ? decoded.usage : undefined
  // xAI reports image counts rather than tokens, seconds, or credits; the raw record stays in provider metadata.
  return new ImageResponse({
    images,
    providerMetadata: usage === undefined ? undefined : { xai: { usage } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["mask", "size", "seed", "format"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<XAIImageOptions>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => (isEdit(request) ? EDIT_PATH : PATH),
    },
    input,
  )

export const XAIImages = {
  protocol,
  model,
} as const
