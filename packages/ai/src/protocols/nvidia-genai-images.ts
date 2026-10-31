import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { MediaProtocol } from "../route/media-protocol.js"
import type { MediaRoute } from "../route/media.js"
import { mergeJsonRecords } from "../schema/index.js"
import { MediaInput } from "./utils/media-input.js"
import { ImageSizing } from "./utils/image-sizing.js"

const route = MediaProtocol.identity({ id: "nvidia-genai-images", name: "NVIDIA GenAI", provider: "nvidia" })
export const DEFAULT_BASE_URL = "https://ai.api.nvidia.com/v1/genai"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Flat per-model inputs; `aspect` and `resolution` lower to `width` and `height` on the FLUX models. */
export type NvidiaImageOptions = {
  readonly width?: number
  readonly height?: number
  readonly seed?: number
  readonly steps?: number
  readonly cfg_scale?: number
  readonly mode?: string
  /** The hosted preview only accepts its own example ids here, such as `data:image/png;example_id,0`. */
  readonly image?: string
} & Record<string, unknown>

export type Request = ImageRequestFor<NvidiaImageOptions>

// ---------------------------------------------------------------------------
// 2. Response schema
// ---------------------------------------------------------------------------

const GenAIResponse = Schema.Struct({
  artifacts: Schema.Array(
    Schema.Struct({
      base64: Schema.String,
      finishReason: Schema.optional(Schema.String),
      seed: Schema.optional(Schema.Number),
    }),
  ),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

const edges = (min: number, max: number, step: number) =>
  Array.from({ length: (max - min) / step + 1 }, (_, index) => min + index * step)

const grid = (widths: ReadonlyArray<number>, heights = widths) =>
  widths.flatMap((width) => heights.map((height) => ({ width, height })))

// The hosted API validates width and height against a fixed list per model. The catalog spells `flux.1` as `flux_1`.
const SIZES: ReadonlyArray<readonly [RegExp, ReadonlyArray<ImageSizing.Size>]> = [
  [/flux[._]1-(schnell|dev)$/, grid(edges(768, 1344, 64))],
  [/flux[._]2-klein-4b$/, grid(edges(512, 1568, 16))],
  [
    /flux[._]1-kontext-dev$/,
    grid([672, 688, 720, 752, 800, 832, 880, 944, 1024, 1104, 1184, 1248, 1328, 1392, 1456, 1504, 1568]),
  ],
]

const sizing = (request: Request) => {
  if (!ImageSizing.isRequested(request)) return Effect.succeed(undefined)
  const sizes = SIZES.find(([pattern]) => pattern.test(request.model.id))?.[1]
  if (sizes !== undefined) return Effect.succeed(ImageSizing.nearest(request, sizes))
  return Effect.fail(
    route.unsupported(
      request.resolution === undefined ? "media.aspect" : "media.resolution",
      `${route.name} does not know the sizes ${request.model.id} accepts; set width and height in providerOptions`,
    ),
  )
}

const fromRequest = Effect.fn("NvidiaGenAIImages.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* route.unsupported("media.n", `${route.name} generates one image per request; call it once per image`)
  return MediaProtocol.json(
    mergeJsonRecords(
      { prompt: request.prompt, ...(yield* sizing(request)) },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeDocument = route.decodeJson(GenAIResponse)

const decodeResponse = Effect.fn("NvidiaGenAIImages.decodeResponse")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodeDocument(response)
  const artifacts = output.value.artifacts
  const reasons = new Set(artifacts.map((artifact) => artifact.finishReason))
  const rendered = artifacts.filter(
    (artifact) => artifact.finishReason !== "CONTENT_FILTERED" && artifact.finishReason !== "ERROR",
  )
  if (rendered.length === 0 && reasons.has("CONTENT_FILTERED"))
    return yield* output.contentPolicy(`${route.name} filtered the image for content safety`)
  if (rendered.length === 0 && reasons.has("ERROR"))
    return yield* output.ended("failed", `${route.name} failed to generate the image`)
  if (rendered.length === 0) return yield* output.invalid(`${route.name} returned no images`)
  const images = yield* Effect.forEach(rendered, (artifact, index) =>
    MediaInput.decodedAsset(output.invalid, `${route.name} result ${index}`, artifact.base64, undefined, {
      providerMetadata: artifact.seed === undefined ? undefined : { nvidia: { seed: artifact.seed } },
    }),
  )
  return new ImageResponse({ images })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.inline<Request, ImageResponse>(route, {
  // The hosted preview rejects caller images ("Expected: example_id, got: base64").
  unsupported: ["images"],
  body: { from: fromRequest },
  response: { decode: decodeResponse },
})

/**
 * A base URL ending in `/genai` is the shared gateway and gets `/{model}` appended. Any other base URL is the
 * model's own invoke URL, as the catalog lists it, and is used as is.
 */
export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<NvidiaImageOptions>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path:
        input.baseURL === undefined || /\/genai\/*$/.test(input.baseURL) ? ({ request }) => `/${request.model.id}` : "",
    },
    input,
  )

export const NvidiaGenAIImages = {
  protocol,
  model,
} as const
