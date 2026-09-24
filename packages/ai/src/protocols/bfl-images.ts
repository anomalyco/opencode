import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({ id: "bfl-images", name: "Black Forest Labs", provider: "black-forest-labs" })
export const DEFAULT_BASE_URL = "https://api.bfl.ai"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type BlackForestLabsImageOptions = {
  readonly safety_tolerance?: number
  readonly prompt_upsampling?: boolean
  readonly disable_pup?: boolean
  readonly raw?: boolean
  readonly guidance?: number
  readonly steps?: number
} & Record<string, unknown>

export type Request = ImageRequestFor<BlackForestLabsImageOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** Regional clusters answer on different hosts, so the returned `polling_url` is followed verbatim. */
export const Token = Schema.Struct({ id: Schema.String, pollingURL: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({
  id: Schema.String,
  polling_url: Schema.String,
})

const Result = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  result: optionalNull(
    Schema.StructWithRest(
      Schema.Struct({ sample: Schema.String, seed: optionalNull(Schema.Number), prompt: optionalNull(Schema.String) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
  cost: optionalNull(Schema.Number),
})

const STATUS = {
  Pending: "running",
  Reasoning: "running",
  Generating: "running",
  Ready: "completed",
  Error: "failed",
  // Moderation is terminal; `decodeResult` reports it as a content-policy failure.
  "Content Moderated": "failed",
  "Request Moderated": "failed",
  "Task not found": "expired",
} as const satisfies Record<string, Status>

const isModerated = (status: string) => status === "Content Moderated" || status === "Request Moderated"

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

interface Capabilities {
  readonly sizing: "dimensions" | "aspectRatio" | "none"
  /** `input_image` numbers extra references `input_image_2`…; the other fields take one image. */
  readonly imageField: "input_image" | "image_prompt" | "image"
  readonly maxImages: number
  readonly mask: boolean
}

const capabilities = (model: string): Capabilities => {
  if (model.startsWith("flux-pro-1.0-fill")) return { sizing: "none", imageField: "image", maxImages: 1, mask: true }
  if (model.startsWith("flux-pro-1.0-expand")) return { sizing: "none", imageField: "image", maxImages: 1, mask: false }
  if (model.startsWith("flux-kontext"))
    return { sizing: "aspectRatio", imageField: "input_image", maxImages: 4, mask: false }
  if (model.startsWith("flux-pro-1.1-ultra"))
    return { sizing: "aspectRatio", imageField: "image_prompt", maxImages: 1, mask: false }
  if (model.startsWith("flux-pro-1.1") || model.startsWith("flux-dev"))
    return { sizing: "dimensions", imageField: "image_prompt", maxImages: 1, mask: false }
  if (model.startsWith("flux-2-klein"))
    return { sizing: "dimensions", imageField: "input_image", maxImages: 4, mask: false }
  return { sizing: "dimensions", imageField: "input_image", maxImages: 8, mask: false }
}

const validate = (request: Request, model: Capabilities) => {
  const id = request.model.id
  const images = request.images?.length ?? 0
  if (request.n !== undefined && request.n > 1)
    return Effect.fail(route.unsupported("media.n", `${id} generates one image per request; call it once per image`))
  if (request.size !== undefined && model.sizing !== "dimensions")
    return Effect.fail(route.unsupported("media.size", `${id} does not take size (width and height)`))
  if (request.aspectRatio !== undefined && model.sizing !== "aspectRatio")
    return Effect.fail(route.unsupported("media.aspectRatio", `${id} does not take aspectRatio`))
  if (images > model.maxImages)
    return Effect.fail(route.unsupported("media.images", `${id} takes at most ${model.maxImages} images`))
  if (request.mask !== undefined && !model.mask)
    return Effect.fail(route.unsupported("media.mask", `${id} does not inpaint; use flux-pro-1.0-fill`))
  return Effect.void
}

const imageInput = (asset: Media.Asset) => {
  const value = asset.inline()?.base64 ?? ProviderShared.mediaUrl(asset)
  if (value === undefined)
    return Effect.fail(ProviderShared.invalidRequest(`${route.name} accepts inline images or https URLs`))
  return Effect.succeed(value)
}

const fromRequest = Effect.fn("BlackForestLabsImages.fromRequest")(function* (request: Request) {
  const model = capabilities(request.model.id)
  yield* validate(request, model)
  const images = yield* Effect.forEach(request.images ?? [], imageInput)
  const fields = images.map((image, index) => [
    index === 0 ? model.imageField : `${model.imageField}_${index + 1}`,
    image,
  ])
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        prompt: request.prompt,
        ...(request.size === undefined ? {} : MediaInput.dimensions(request.size)),
        aspect_ratio: request.aspectRatio,
        seed: request.seed,
        output_format: request.format,
        mask: request.mask === undefined ? undefined : yield* imageInput(request.mask),
        ...Object.fromEntries(fields),
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(StartResponse, (value) => ({
  token: { id: value.id, pollingURL: value.polling_url },
  snapshot: { id: value.id, status: "queued" },
}))

const decodeDocument = route.decodeJson(Result)

const decodeStatus = Effect.fn("BlackForestLabsImages.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeDocument(response)
  return { id: context.token.id, status: yield* MediaProtocol.status(STATUS, output.value.status, output) }
})

const decodeResult = Effect.fn("BlackForestLabsImages.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeDocument(response)
  const document = output.value
  const status = yield* MediaProtocol.status(STATUS, document.status, output)
  if (isModerated(document.status)) return yield* output.contentPolicy(`${route.name} moderated the generation`)
  if (status === "failed" || status === "expired")
    return yield* output.ended(status, `${route.name} generation ${context.token.id} ended with ${document.status}`)
  if (status !== "completed" || document.result === undefined || document.result === null)
    return yield* output.invalid(`${route.name} generation ${context.token.id} has no result`)
  const { sample, seed, prompt, ...rest } = document.result
  return new ImageResponse({
    // `sample` is a signed URL that expires 10 minutes after the result is ready, so it is downloaded now.
    images: [yield* context.materialize(Media.url(sample))],
    usage:
      document.cost === undefined || document.cost === null ? undefined : { type: "credits", credits: document.cost },
    providerMetadata: {
      bfl: { id: context.token.id, seed: seed ?? undefined, prompt: prompt ?? undefined, ...rest },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.queued<Request, ImageResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: (token) => token.pollingURL, decode: decodeStatus },
  result: { path: (token) => token.pollingURL, decode: decodeResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<BlackForestLabsImageOptions, Token>(
    { protocol, baseURL: DEFAULT_BASE_URL, path: ({ request }) => `/v1/${request.model.id}` },
    input,
  )

export const BlackForestLabsImages = {
  protocol,
  model,
} as const
