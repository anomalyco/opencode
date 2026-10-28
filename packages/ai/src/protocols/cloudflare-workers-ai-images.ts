import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import type { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { ProviderShared } from "./shared.js"
import { ImageSizing } from "./utils/image-sizing.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({
  id: "cloudflare-workers-ai-images",
  name: "Cloudflare Workers AI",
  provider: "cloudflare-workers-ai",
})
/** FLUX.2 models only accept multipart form fields, even for a prompt alone. */
const MULTIPART_MODEL_PREFIX = "@cf/black-forest-labs/flux-2-"
const RESERVED_FORM_FIELDS = new Set(["prompt"])

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Native Run API inputs. Step counts are `steps` on FLUX and Lucid Origin and `num_steps` on the other models;
 * `aspect` and `resolution` lower to `width` and `height`.
 */
export type CloudflareWorkersAIImageOptions = {
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly steps?: number
  readonly num_steps?: number
  readonly guidance?: number
  readonly negative_prompt?: string
} & Record<string, unknown>

export type Request = ImageRequestFor<CloudflareWorkersAIImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const RunResponse = Schema.Struct({
  result: Schema.Struct({
    image: Schema.optional(Schema.String),
    usage: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const fromRequest = Effect.fn("CloudflareWorkersAIImages.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported("media.n", `${route.name} generates one image per request; call it once per image`)
  const fields = {
    prompt: request.prompt,
    ...(yield* ImageSizing.exact(route, request, { multiple: 16, minEdge: 256, maxEdge: 2048 })),
  }
  const native = mergeJsonRecords(request.providerOptions, request.http?.body)
  const images = request.images ?? []
  if (!request.model.id.startsWith(MULTIPART_MODEL_PREFIX)) {
    if (images.length > 1)
      return yield* route.unsupported("media.images", `${request.model.id} takes one input image as image_b64`)
    const image = images[0]?.inline()
    if (images[0] !== undefined && image === undefined) return yield* ProviderShared.inlineRequired(route.id, images[0])
    return MediaProtocol.json(mergeJsonRecords({ ...fields, image_b64: image?.base64 }, native) ?? {})
  }
  const body = new FormData()
  MediaInput.appendFields(body, fields, { overlay: native, reserved: RESERVED_FORM_FIELDS })
  yield* Effect.forEach(images, (image, index) =>
    MediaInput.inlineBytes(route.id, image).pipe(
      Effect.map((bytes) =>
        body.append(`input_image_${index}`, MediaInput.blob(bytes, image.mediaType), `image_${index}`),
      ),
    ),
  )
  return MediaProtocol.multipart(body)
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(RunResponse)

// FLUX and Lucid Origin wrap base64 in the Run API envelope; the Stable Diffusion family, DreamShaper, and Phoenix
// answer with the raw image, whose declared content type does not always match the bytes.
const decodeResponse = Effect.fn("CloudflareWorkersAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (!response.headers["content-type"]?.startsWith("application/json"))
    return new ImageResponse({ images: [Media.bytes(yield* route.bytes(response))] })
  const output = yield* decodeDocument(response)
  const result = output.value.result
  if (result.image === undefined) return yield* output.invalid(`${route.name} returned no image`)
  return new ImageResponse({
    images: [yield* MediaInput.decodedAsset(output.invalid, `${route.name} result`, result.image, undefined)],
    providerMetadata: result.usage === undefined ? undefined : { "cloudflare-workers-ai": { usage: result.usage } },
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
  ImageModel.fromRoute<CloudflareWorkersAIImageOptions>(
    { protocol, path: ({ request }) => `/${request.model.id}` },
    input,
  )

export const CloudflareWorkersAIImages = {
  protocol,
  model,
} as const
