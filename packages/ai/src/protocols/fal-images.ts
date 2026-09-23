import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"
import { FalQueue } from "./utils/fal-queue.js"
import { MediaInput } from "./utils/media-input.js"

const ADAPTER = "fal-images"
const NAME = "fal Images"
const PROVIDER = ProviderID.make("fal")

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type FalImageOptions = {
  readonly image_size?:
    | "square_hd"
    | "square"
    | "portrait_4_3"
    | "portrait_16_9"
    | "landscape_4_3"
    | "landscape_16_9"
    | (string & {})
  readonly enable_safety_checker?: boolean
} & Record<string, unknown>

export type Request = ImageRequestFor<FalImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const QueueResult = Schema.StructWithRest(
  Schema.Struct({
    images: Schema.Array(
      Schema.Struct({
        url: Schema.String,
        width: optionalNull(Schema.Number),
        height: optionalNull(Schema.Number),
        content_type: optionalNull(Schema.String),
      }),
    ),
    seed: optionalNull(Schema.Number),
    has_nsfw_concepts: optionalNull(Schema.Array(Schema.Boolean)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const sizing = (model: string) => {
  if (/^fal-ai\/(nano-banana|flux-pro\/v1\.1-ultra)/.test(model)) return "aspect_ratio"
  if (model.startsWith("fal-ai/flux")) return "image_size"
  return undefined
}

const unsupported = (model: string, field: string, message: string) =>
  ProviderShared.unsupportedOperation({
    operation: `media.${field}`,
    provider: PROVIDER,
    route: ADAPTER,
    message: `${model} ${message}`,
  })

const validate = (request: Request) => {
  const id = request.model.id
  const field = sizing(id)
  if (request.size !== undefined && request.aspectRatio !== undefined)
    return Effect.fail(ProviderShared.invalidRequest(`${NAME} accepts either size or aspectRatio, not both`))
  if (request.size !== undefined && field === "aspect_ratio")
    return Effect.fail(unsupported(id, "size", "sizes by aspectRatio"))
  if (request.aspectRatio !== undefined && field === "image_size")
    return Effect.fail(unsupported(id, "aspectRatio", "sizes by size (image_size)"))
  if ((request.images?.length ?? 0) > 1 && !isEdit(id))
    return Effect.fail(unsupported(id, "images", "takes one image_url; use an /edit endpoint for several images"))
  return Effect.void
}

// `/edit` endpoints take an `image_urls` list; image-to-image, fill, and Ultra take one `image_url` (beside `mask_url`).
const isEdit = (model: string) => model.endsWith("/edit")

const fromRequest = Effect.fn("FalImages.fromRequest")(function* (request: Request) {
  yield* validate(request)
  const images = yield* Effect.forEach(request.images ?? [], (image) => FalQueue.mediaUrl(image, NAME))
  const edit = isEdit(request.model.id)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        prompt: request.prompt,
        num_images: request.n,
        seed: request.seed,
        image_size: request.size === undefined ? undefined : MediaInput.dimensions(request.size),
        aspect_ratio: request.aspectRatio,
        output_format: request.format,
        image_urls: edit && images.length > 0 ? images : undefined,
        image_url: edit ? undefined : images[0],
        mask_url: request.mask === undefined ? undefined : yield* FalQueue.mediaUrl(request.mask, NAME),
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeQueueResult = MediaProtocol.decodeJson(ADAPTER, NAME, QueueResult)

const decodeResult = Effect.fn("FalImages.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<FalQueue.Token>,
) {
  const output = yield* decodeQueueResult(response)
  const { images, seed, has_nsfw_concepts, ...rest } = output.value
  if (images.length === 0) return yield* output.invalid(`${NAME} returned no images`)
  // With the safety checker on, flagged images come back blacked out rather than omitted.
  const flagged = (has_nsfw_concepts ?? []).flatMap((value, index) => (value ? [index] : []))
  return new ImageResponse({
    images: images.map((image) =>
      Media.url(image.url, {
        mediaType: image.content_type ?? undefined,
        info: { width: image.width ?? undefined, height: image.height ?? undefined },
      }),
    ),
    notices:
      flagged.length === 0
        ? undefined
        : flagged.map((index) => ({ type: "moderated" as const, message: `${NAME} flagged image ${index} as NSFW` })),
    providerMetadata: { fal: { requestId: context.token.requestID, seed: seed ?? undefined, ...rest } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = FalQueue.protocol<Request, ImageResponse>({
  id: ADAPTER,
  name: NAME,
  from: fromRequest,
  decodeResult,
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<FalImageOptions, FalQueue.Token>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: FalQueue.DEFAULT_BASE_URL,
      path: ({ request }) => `/${request.model.id}`,
    },
    input,
  )

export const FalImages = {
  protocol,
  model,
} as const
