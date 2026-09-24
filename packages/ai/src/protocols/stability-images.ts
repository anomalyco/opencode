import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "stability-images", name: "Stability AI", provider: "stability" })
const upscaleRoute = MediaProtocol.identity({ id: "stability-upscale", name: "Stability AI", provider: "stability" })
export const DEFAULT_BASE_URL = "https://api.stability.ai"
const RESULTS_PATH = "/v2beta/results"
const UPSCALE_MODEL = "creative"
/** Base64 JSON instead of raw bytes, so the seed and finish reason arrive with the image. */
const HEADERS = { accept: "application/json" }

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type StabilityStylePreset = OpenString<
  | "enhance"
  | "anime"
  | "photographic"
  | "digital-art"
  | "comic-book"
  | "fantasy-art"
  | "line-art"
  | "analog-film"
  | "neon-punk"
  | "isometric"
  | "low-poly"
  | "origami"
  | "modeling-compound"
  | "cinematic"
  | "3d-model"
  | "pixel-art"
  | "tile-texture"
>

export type StabilityImageOptions = {
  readonly negative_prompt?: string
  readonly style_preset?: StabilityStylePreset
  readonly strength?: number
  readonly cfg_scale?: number
} & Record<string, unknown>

/** Creative upscale options; the one `images` source is the image to upscale. */
export type StabilityUpscaleOptions = {
  readonly negative_prompt?: string
  readonly style_preset?: StabilityStylePreset
  readonly creativity?: number
} & Record<string, unknown>

export type Request = ImageRequestFor<StabilityImageOptions>
export type UpscaleRequest = ImageRequestFor<StabilityUpscaleOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ id: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

// Generate names the base64 image `image`; `/v2beta/results/{id}` names it `result`.
const ImageDocument = Schema.Struct({
  image: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  seed: Schema.optional(Schema.Number),
  finish_reason: Schema.optional(Schema.String),
})

const Started = Schema.Struct({ id: Schema.String })

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

/** `sd3.5-*` ids share the `sd3` endpoint and select the model with a form field. */
const endpoint = (model: string) => (model.startsWith("sd3") ? "sd3" : model)

const RESERVED_FORM_FIELDS = new Set(["image", "prompt", "mode", "model"])

const form = Effect.fn("StabilityImages.form")(function* (
  identity: MediaProtocol.Identity,
  fields: Record<string, unknown>,
  native: Record<string, unknown> | undefined,
  source: Request["images"],
) {
  if ((source?.length ?? 0) > 1)
    return yield* identity.unsupported("media.images", `${identity.name} takes one source image`)
  const body = new FormData()
  MediaInput.appendFields(body, fields, { overlay: native, reserved: RESERVED_FORM_FIELDS })
  const image = source?.[0]
  if (image !== undefined)
    body.append("image", MediaInput.blob(yield* MediaInput.inlineBytes(identity.id, image), image.mediaType), "image")
  return MediaProtocol.multipart(body)
})

const fromRequest = Effect.fn("StabilityImages.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported("media.n", `${route.name} generates one image per request; call it once per image`)
  const target = endpoint(request.model.id)
  const edit = (request.images?.length ?? 0) > 0
  if (edit && target === "core")
    return yield* route.unsupported("media.images", `${route.name} core is text-to-image only; use ultra or sd3.5-*`)
  return yield* form(
    route,
    {
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio,
      seed: request.seed,
      output_format: request.format,
      model: target === "sd3" ? request.model.id : undefined,
      mode: target === "sd3" && edit ? "image-to-image" : undefined,
    },
    mergeJsonRecords(request.providerOptions, request.http?.body),
    request.images,
  )
})

const fromUpscaleRequest = Effect.fn("StabilityImages.fromUpscaleRequest")(function* (request: UpscaleRequest) {
  if ((request.images?.length ?? 0) === 0)
    return yield* ProviderShared.invalidRequest(`${upscaleRoute.name} upscale requires the source image in images`)
  return yield* form(
    upscaleRoute,
    { prompt: request.prompt, seed: request.seed, output_format: request.format },
    mergeJsonRecords(request.providerOptions, request.http?.body),
    request.images,
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeImageDocument = (identity: MediaProtocol.Identity) => {
  const decode = identity.decodeJson(ImageDocument)
  return Effect.fn("StabilityImages.decodeImage")(function* (response: HttpClientResponse.HttpClientResponse) {
    const output = yield* decode(response)
    const document = output.value
    const data = document.image ?? document.result
    if (data === undefined) return yield* output.invalid(`${identity.name} returned no image`)
    const image = yield* MediaInput.decodedAsset(output.invalid, `${identity.name} result`, data, undefined)
    return new ImageResponse({
      images: [image],
      notices:
        document.finish_reason === "CONTENT_FILTERED"
          ? [{ type: "moderated", message: `${identity.name} blurred the image for violating its content policy` }]
          : undefined,
      providerMetadata: { stability: { seed: document.seed, finishReason: document.finish_reason } },
    })
  })
}

const decodeResponse = decodeImageDocument(route)
const decodeUpscaleImage = decodeImageDocument(upscaleRoute)

const decodeStart = upscaleRoute.decodeStarted(Started, (value) => ({
  token: { id: value.id },
  snapshot: { id: value.id, status: "queued" },
}))

// `/v2beta/results/{id}` answers 202 while in progress and 200 with the finished image document.
const decodeStatus = (response: HttpClientResponse.HttpClientResponse, context: MediaProtocol.PollContext<Token>) =>
  Effect.succeed({
    id: context.token.id,
    status: response.status === 202 ? ("running" as const) : ("completed" as const),
  })

const decodeUpscaleResult = Effect.fn("StabilityImages.decodeUpscaleResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  if (response.status === 202) {
    const output = yield* upscaleRoute.text(response)
    return yield* output.invalid(`${upscaleRoute.name} upscale ${context.token.id} has not finished`)
  }
  return yield* decodeUpscaleImage(response)
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>(route, {
  unsupported: ["size", "mask"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

export const upscaleProtocol = MediaProtocol.queued<UpscaleRequest, ImageResponse, Token>(upscaleRoute, {
  token: Token,
  unsupported: ["n", "size", "aspectRatio", "mask"],
  start: { body: { from: fromUpscaleRequest }, decode: decodeStart },
  status: { path: (token) => `${RESULTS_PATH}/${token.id}`, decode: decodeStatus },
  result: { path: (token) => `${RESULTS_PATH}/${token.id}`, decode: decodeUpscaleResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<StabilityImageOptions>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      headers: HEADERS,
      path: ({ request }) => `/v2beta/stable-image/generate/${endpoint(request.model.id)}`,
    },
    input,
  )

export const upscaleModel = (input: Omit<MediaRoute.ModelInput, "id">) =>
  ImageModel.fromRoute<StabilityUpscaleOptions, Token>(
    {
      protocol: upscaleProtocol,
      baseURL: DEFAULT_BASE_URL,
      headers: HEADERS,
      // Only the creative upscaler is asynchronous; fast and conservative answer inline.
      path: `/v2beta/stable-image/upscale/${UPSCALE_MODEL}`,
    },
    { ...input, id: UPSCALE_MODEL },
  )

export const StabilityImages = {
  protocol,
  upscaleProtocol,
  model,
  upscaleModel,
} as const
