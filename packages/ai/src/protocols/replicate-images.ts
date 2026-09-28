import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { ImageModel, ImageResponse, type ImageRequestFor } from "../image.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, type AIError } from "../schema/index.js"
import { ProviderShared, optionalNull } from "./shared.js"

const route = MediaProtocol.identity({ id: "replicate-images", name: "Replicate", provider: "replicate" })
export const DEFAULT_BASE_URL = "https://api.replicate.com"
const OUTPUT_RETENTION = Duration.hours(1)
const MAX_DATA_URL_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/** Model-defined `input` fields under the model's own names; `Media.Asset` values lower to URLs or data URLs. */
export type ReplicateImageOptions = Record<string, unknown>

export type Request = ImageRequestFor<ReplicateImageOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

export const Token = Schema.Struct({ id: Schema.String, getURL: Schema.String, cancelURL: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const Prediction = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  output: optionalNull(Schema.Unknown),
  error: optionalNull(Schema.Unknown),
  data_removed: optionalNull(Schema.Boolean),
  completed_at: optionalNull(Schema.String),
  metrics: optionalNull(Schema.Struct({ predict_time: optionalNull(Schema.Number) })),
  urls: Schema.Struct({ get: Schema.String, cancel: Schema.String }),
})

const Output = Schema.Union([Schema.String, Schema.Array(Schema.String)])
const isOutput = Schema.is(Output)

const STATUS = {
  starting: "queued",
  processing: "running",
  succeeded: "completed",
  failed: "failed",
  canceled: "cancelled",
  // The prediction hit its `Cancel-After` deadline before it started running.
  aborted: "expired",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// Official models run by `owner/name`; anything else (`owner/name:version` or a bare version id) is a pinned version.
const isOfficial = (model: string) => /^[^/:]+\/[^/:]+$/.test(model)

const inlineSize = (source: Media.Source) => {
  if (source.type === "bytes") return source.data.byteLength
  if (source.type === "base64") return source.data.length * 0.75
  return 0
}

const fileInput = (asset: Media.Asset) => {
  if (inlineSize(asset.source) > MAX_DATA_URL_BYTES)
    return Effect.fail(
      ProviderShared.invalidRequest(
        `${route.name} data URL inputs are limited to 256 KB; pass a larger file by https URL`,
      ),
    )
  return ProviderShared.mediaReference(asset, undefined, route.name).pipe(Effect.map((reference) => reference.value))
}

const inputValue = (value: unknown): Effect.Effect<unknown, AIError> => {
  if (value instanceof Media.Asset) return fileInput(value)
  if (Array.isArray(value) && value.some((item) => item instanceof Media.Asset))
    return Effect.forEach(value, (item) => (item instanceof Media.Asset ? fileInput(item) : Effect.succeed(item)))
  return Effect.succeed(value)
}

const fromRequest = Effect.fn("ReplicateImages.fromRequest")(function* (request: Request) {
  const native = yield* Effect.forEach(Object.entries(request.providerOptions ?? {}), ([key, value]) =>
    inputValue(value).pipe(Effect.map((lowered) => [key, lowered] as const)),
  )
  const input = mergeJsonRecords({ prompt: request.prompt }, Object.fromEntries(native))
  const model = request.model.id
  return MediaProtocol.json(
    mergeJsonRecords(isOfficial(model) ? { input } : { version: model, input }, request.http?.body) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodePrediction = route.decodeJson(Prediction)

const decodeStart = Effect.fn("ReplicateImages.decodeStart")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const output = yield* decodePrediction(response)
  const prediction = output.value
  return {
    token: { id: prediction.id, getURL: prediction.urls.get, cancelURL: prediction.urls.cancel },
    // `Prefer: wait` can return an already-finished prediction, so `await` skips straight to the result.
    snapshot: { id: prediction.id, status: yield* MediaProtocol.status(STATUS, prediction.status, output) },
  }
})

const decodeStatus = Effect.fn("ReplicateImages.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodePrediction(response)
  return { id: context.token.id, status: yield* MediaProtocol.status(STATUS, output.value.status, output) }
})

const decodeResult = Effect.fn("ReplicateImages.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodePrediction(response)
  const prediction = output.value
  const status = yield* MediaProtocol.status(STATUS, prediction.status, output)
  if (status === "failed" || status === "cancelled" || status === "expired")
    return yield* output.ended(
      status,
      `${route.name} prediction ${context.token.id} ${prediction.status}${typeof prediction.error === "string" ? `: ${prediction.error}` : ""}`,
    )
  if (status !== "completed") return yield* output.pending(context.token.id)
  if (prediction.data_removed === true)
    return yield* output.ended("expired", `${route.name} removed the output of prediction ${context.token.id}`)
  if (!isOutput(prediction.output))
    return yield* output.invalid(`${route.name} prediction ${context.token.id} returned output that is not image URLs`)
  const urls = typeof prediction.output === "string" ? [prediction.output] : prediction.output
  if (urls.length === 0) return yield* output.invalid(`${route.name} prediction ${context.token.id} returned no images`)
  const predictTime = prediction.metrics?.predict_time ?? undefined
  const completedAt = prediction.completed_at ?? undefined
  const expiresAt =
    completedAt === undefined ? undefined : Date.parse(completedAt) + Duration.toMillis(OUTPUT_RETENTION)
  return new ImageResponse({
    images: urls.map((url) => Media.url(url, { expiresAt })),
    usage: predictTime === undefined ? undefined : { type: "compute", seconds: predictTime },
    providerMetadata: { replicate: { predictionId: prediction.id } },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

export const protocol = MediaProtocol.queued<Request, ImageResponse, Token>(route, {
  token: Token,
  unsupported: ["images", "mask", "n", "size", "aspectRatio", "seed", "format"],
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: (token) => token.getURL, decode: decodeStatus },
  result: { path: (token) => token.getURL, decode: decodeResult },
  cancel: { method: "POST", path: (token) => token.cancelURL },
})

export const model = (input: MediaRoute.ModelInput) =>
  ImageModel.fromRoute<ReplicateImageOptions, Token>(
    {
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) =>
        isOfficial(request.model.id) ? `/v1/models/${request.model.id}/predictions` : "/v1/predictions",
    },
    input,
  )

export const ReplicateImages = {
  protocol,
  model,
} as const
