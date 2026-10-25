import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type OpenString } from "../schema/index.js"
import { optionalNull } from "./shared.js"
import { FalQueue } from "./utils/fal-queue.js"
import { ImageSizing } from "./utils/image-sizing.js"

const route = MediaProtocol.identity({ id: "fal-images", name: "fal Images", provider: "fal" })

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Model-defined `input` fields; `aspect` and `resolution` lower to `image_size` or `aspect_ratio` per model. */
export type FalImageOptions = {
  readonly image_size?:
    | OpenString<"square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9">
    | { readonly width: number; readonly height: number }
  readonly seed?: number
  readonly output_format?: OpenString<"jpeg" | "png" | "webp">
  /** Inpainting mask, sent as `mask_url`. */
  readonly mask?: Media.Asset
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

/** Nano Banana takes `aspect_ratio` and `resolution` tiers, FLUX Ultra and Kontext only `aspect_ratio`, FLUX `image_size`. */
const sizing = (model: string) => {
  if (model.startsWith("fal-ai/nano-banana")) return "tiers"
  if (/^fal-ai\/flux-pro\/(v1\.1-ultra|kontext)/.test(model)) return "aspect_ratio"
  if (model.startsWith("fal-ai/flux")) return "image_size"
  return undefined
}

const validate = (request: Request) => {
  const id = request.model.id
  if (request.resolution !== undefined && sizing(id) === "aspect_ratio")
    return Effect.fail(route.unsupported("media.resolution", `${id} sizes by aspect only`))
  if ((request.images?.length ?? 0) > 1 && !takesImageList(id))
    return Effect.fail(
      route.unsupported(
        "media.images",
        `${id} takes one image_url; use an /edit or /multi endpoint for several images`,
      ),
    )
  return Effect.void
}

// `/edit` and `/multi` (Kontext) endpoints take an `image_urls` list; image-to-image, fill, and Ultra take one
// `image_url` (beside `mask_url`).
const takesImageList = (model: string) => model.endsWith("/edit") || model.endsWith("/multi")

const fromRequest = Effect.fn("FalImages.fromRequest")(function* (request: Request) {
  yield* validate(request)
  const images = yield* Effect.forEach(request.images ?? [], (image) => FalQueue.mediaUrl(image, route.name))
  const list = takesImageList(request.model.id)
  const { mask, ...native } = request.providerOptions ?? {}
  const field = sizing(request.model.id)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        prompt: request.prompt,
        num_images: request.n,
        ...(field === "image_size"
          ? { image_size: yield* ImageSizing.exact(route, request, { multiple: 16 }) }
          : { aspect_ratio: request.aspect, resolution: request.resolution }),
        image_urls: list && images.length > 0 ? images : undefined,
        image_url: list ? undefined : images[0],
        mask_url: mask === undefined ? undefined : yield* FalQueue.mediaUrl(mask, route.name),
      },
      native,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeQueueResult = route.decodeJson(QueueResult)

const decodeResult = Effect.fn("FalImages.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<FalQueue.Token>,
) {
  const output = yield* decodeQueueResult(response)
  const { images, seed, has_nsfw_concepts, ...rest } = output.value
  if (images.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  // With the safety checker on, flagged images come back blacked out rather than omitted.
  const flagged = (has_nsfw_concepts ?? []).flatMap((value, index) => (value ? [index] : []))
  return new ImageResponse({
    images: images.map((image) => {
      const info = { width: image.width ?? undefined, height: image.height ?? undefined }
      // `sync_mode: true` returns data URIs instead of hosted URLs.
      return (
        Media.parseDataUrl(image.url, { info }) ??
        Media.url(image.url, { mediaType: image.content_type ?? undefined, info })
      )
    }),
    notices:
      flagged.length === 0
        ? undefined
        : flagged.map((index) => ({
            type: "moderated" as const,
            message: `${route.name} flagged image ${index} as NSFW`,
          })),
    providerMetadata: { fal: { requestId: context.token.requestID, seed: seed ?? undefined, ...rest } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = FalQueue.protocol<Request, ImageResponse>(route, {
  from: fromRequest,
  decodeResult,
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<FalImageOptions, FalQueue.Token>(
    { protocol, baseURL: FalQueue.DEFAULT_BASE_URL, path: ({ request }) => `/${request.model.id}` },
    input,
  )

export const FalImages = {
  protocol,
  model,
} as const
