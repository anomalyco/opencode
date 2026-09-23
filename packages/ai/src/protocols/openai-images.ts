import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords, type AIError } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const ADAPTER = "openai-images"
const NAME = "OpenAI Images"
const PROVIDER = ProviderID.make("openai")
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/images/generations"
export const EDIT_PATH = "/images/edits"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type OpenAIImageString<Known extends string> = Known | (string & {})

/** Provider-native options. Common fields (`n`, `size`, `format`, `images`, `mask`) live on the request. */
export type OpenAIImageOptions = {
  readonly quality?: OpenAIImageString<"auto" | "low" | "medium" | "high" | "standard" | "hd">
  readonly background?: OpenAIImageString<"auto" | "opaque" | "transparent">
  readonly moderation?: OpenAIImageString<"auto" | "low">
  readonly outputCompression?: number
} & Record<string, unknown>

export type Request = ImageRequestFor<OpenAIImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const OpenAIImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      revised_prompt: Schema.optional(Schema.String),
    }),
  ),
  output_format: Schema.optional(Schema.String),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
      total_tokens: Schema.optional(Schema.Number),
      input_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      output_tokens_details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** Multipart field names the route owns; `http.body` overlays cannot smuggle replacements for them. */
const RESERVED_FORM_FIELDS = new Set(["model", "prompt", "image", "image[]", "images", "mask"])

const nativeOptions = (options: OpenAIImageOptions | undefined) => {
  if (!options) return undefined
  const { outputCompression, ...native } = options
  return { output_compression: outputCompression, ...native }
}

const isEdit = (request: Request) => (request.images?.length ?? 0) > 0

const isInline = (asset: Media.Asset) => asset.inline() !== undefined

const blob = (data: Uint8Array, mediaType: string) => {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return new Blob([buffer], { type: mediaType })
}

const reference = (asset: Media.Asset): Effect.Effect<Record<string, unknown>, AIError> => {
  const inline = asset.inline()
  if (inline) return Effect.succeed({ image_url: inline.dataUrl })
  const url = ProviderShared.mediaUrl(asset)
  if (url) return Effect.succeed({ image_url: url })
  const id = MediaInput.refID(asset, PROVIDER)
  if (id) return Effect.succeed({ file_id: id })
  return Effect.fail(
    ProviderShared.invalidRequest("OpenAI Images accepts image URLs, data URLs, bytes, and OpenAI file IDs"),
  )
}

const fromRequest = Effect.fn("OpenAIImages.fromRequest")(function* (request: Request) {
  const images = request.images ?? []
  const mask = request.mask
  if (mask !== undefined && images.length === 0)
    return yield* ProviderShared.invalidRequest("An OpenAI image mask requires at least one input image")
  const fields = mergeJsonRecords(
    { n: request.n, size: request.size, output_format: request.format },
    nativeOptions(request.providerOptions),
    request.http?.body,
  )

  // Owned bytes go through multipart edits; remote URLs and file IDs use the JSON edits body instead.
  if (images.length > 0 && images.every(isInline) && (mask === undefined || isInline(mask))) {
    const form = new FormData()
    form.append("model", request.model.id)
    form.append("prompt", request.prompt)
    Object.entries(fields ?? {}).forEach(([key, value]) => {
      if (RESERVED_FORM_FIELDS.has(key)) return
      form.append(key, typeof value === "string" ? value : ProviderShared.encodeJson(value))
    })
    const uploads = yield* Effect.forEach(images, (image) => MediaInput.inlineBytes(ADAPTER, image))
    uploads.forEach((data, index) => form.append("image[]", blob(data, images[index].mediaType), `image-${index}`))
    if (mask !== undefined)
      form.append("mask", blob(yield* MediaInput.inlineBytes(ADAPTER, mask), mask.mediaType), "mask")
    return MediaProtocol.multipart(form)
  }

  const references = yield* Effect.forEach(images, reference)
  const maskReference = mask === undefined ? undefined : yield* reference(mask)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        prompt: request.prompt,
        images: references.length === 0 ? undefined : references,
        mask: maskReference,
      },
      fields,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const requestedFormat = (body: MediaProtocol.Body) => {
  const value = body.type === "json" ? body.value.output_format : body.value.get("output_format")
  return typeof value === "string" ? value : undefined
}

const decodeResponse = Effect.fn("OpenAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.DecodeContext<Request>,
) {
  const output = yield* MediaProtocol.decodeJson(ADAPTER, NAME, OpenAIImageResponse)(response)
  const decoded = output.value
  const format = decoded.output_format ?? requestedFormat(context.body) ?? "png"
  const mediaType = `image/${format}`
  const images = yield* Effect.forEach(decoded.data, (item, index) => {
    const providerMetadata =
      item.revised_prompt === undefined ? undefined : { openai: { revisedPrompt: item.revised_prompt } }
    if (item.b64_json)
      return MediaInput.decodedAsset(output.invalid, `${NAME} result ${index}`, item.b64_json, mediaType, {
        info: { format },
        providerMetadata,
      })
    if (item.url) return Effect.succeed(Media.url(item.url, { mediaType, info: { format }, providerMetadata }))
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
            details: { openai: decoded.usage },
          },
    providerMetadata: { openai: { outputFormat: format } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>({
  id: ADAPTER,
  name: NAME,
  unsupported: ["aspectRatio", "seed"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<OpenAIImageOptions>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => (isEdit(request) ? EDIT_PATH : PATH),
    },
    input,
  )

export const OpenAIImages = {
  protocol,
  model,
} as const
