import { Duration, Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, mergeJsonRecords } from "../schema/index.js"
import { VideoModel, VideoResponse, type VideoRequestFor } from "../video.js"
import { ProviderShared, optionalArray } from "./shared.js"

const ADAPTER = "google-video"
const NAME = "Google Veo"
const PROVIDER = ProviderID.make("google")
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
/** Veo keeps generated files for two days; the asset carries that deadline so callers materialize in time. */
const FILE_RETENTION = Duration.days(2)

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

export type GoogleVideoString<Known extends string> = Known | (string & {})

/** Provider-native `parameters`. Common fields (`aspectRatio`, `resolution`, `durationSeconds`, `seed`) live on the request. */
export type GoogleVideoOptions = {
  readonly personGeneration?: GoogleVideoString<"allow_all" | "allow_adult" | "dont_allow">
} & Record<string, unknown>

export type Request = VideoRequestFor<GoogleVideoOptions>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** The long-running operation name, e.g. `models/veo-3.1-generate-preview/operations/abc123`. */
export const Token = Schema.Struct({ operation: Schema.String })
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({ name: Schema.String })

const Operation = Schema.Struct({
  done: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
  response: Schema.optional(
    Schema.Struct({
      generateVideoResponse: Schema.optional(
        Schema.Struct({
          generatedSamples: optionalArray(
            Schema.Struct({
              video: Schema.optional(
                Schema.Struct({
                  uri: Schema.optional(Schema.String),
                  mimeType: Schema.optional(Schema.String),
                }),
              ),
            }),
          ),
          raiMediaFilteredCount: Schema.optional(Schema.Number),
          raiMediaFilteredReasons: optionalArray(Schema.String),
        }),
      ),
    }),
  ),
  metadata: Schema.optional(Schema.Unknown),
})

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// Veo takes inline media only; a prior Veo output is `Media.url` with transient auth, so materialize it first.
const inlineMedia = (asset: Media.Asset) =>
  ProviderShared.requireInlineMedia(NAME, asset).pipe(
    Effect.map((inline) => ({ inlineData: { mimeType: inline.mime, data: inline.base64 } })),
  )

const fromRequest = Effect.fn("GoogleVideo.fromRequest")(function* (request: Request) {
  if (request.n !== undefined && request.n > 1)
    return yield* ProviderShared.unsupportedOperation({
      operation: "video.n",
      provider: PROVIDER,
      route: ADAPTER,
      message: `${NAME} generates one video per request; call it once per video instead of n=${request.n}`,
    })
  if (request.audio === false)
    return yield* ProviderShared.unsupportedOperation({
      operation: "video.audio",
      provider: PROVIDER,
      route: ADAPTER,
      message: `${NAME} always generates audio; audio: false cannot be honored`,
    })
  if (request.frames?.last !== undefined && request.frames.first === undefined)
    return yield* ProviderShared.invalidRequest(`${NAME} requires frames.first when frames.last is set`)
  const image = request.frames?.first === undefined ? undefined : yield* inlineMedia(request.frames.first)
  const lastFrame = request.frames?.last === undefined ? undefined : yield* inlineMedia(request.frames.last)
  const video = request.video === undefined ? undefined : yield* inlineMedia(request.video)
  const referenceImages = yield* Effect.forEach(request.references ?? [], (asset) =>
    inlineMedia(asset).pipe(Effect.map((image) => ({ image, referenceType: "asset" }))),
  )
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        instances: [
          {
            prompt: request.prompt,
            image,
            lastFrame,
            referenceImages: referenceImages.length === 0 ? undefined : referenceImages,
            video,
          },
        ],
        parameters: mergeJsonRecords(
          {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
            negativePrompt: request.negativePrompt,
            seed: request.seed,
          },
          request.providerOptions,
        ),
      },
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = MediaProtocol.decodeStarted(ADAPTER, NAME, StartResponse, (value) => ({
  token: { operation: value.name },
  snapshot: { id: value.name, status: "running" },
}))

// Operations carry no status string: not done is running, done with `error` failed, otherwise completed.
const statusOf = (operation: typeof Operation.Type): Status => {
  if (operation.done !== true) return "running"
  return operation.error === undefined ? "completed" : "failed"
}

const decodeOperation = MediaProtocol.decodeJson(ADAPTER, NAME, Operation)

const decodeStatus = Effect.fn("GoogleVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeOperation(response)
  return { id: context.token.operation, status: statusOf(output.value) }
})

const decodeResult = Effect.fn("GoogleVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeOperation(response)
  const operation = output.value
  const status = statusOf(operation)
  if (status === "running")
    return yield* output.invalid(`${NAME} operation ${context.token.operation} has not finished`)
  if (status === "failed")
    return yield* output.ended(
      "failed",
      `${NAME} operation failed${operation.error?.message === undefined ? "" : `: ${operation.error.message}`}`,
    )
  const generated = operation.response?.generateVideoResponse
  // Downloads require the same API key as the poll; the asset carries it transiently and follows the redirect.
  const videos = yield* Effect.forEach(
    (generated?.generatedSamples ?? []).flatMap((sample) =>
      sample.video?.uri === undefined ? [] : [{ uri: sample.video.uri, mimeType: sample.video.mimeType }],
    ),
    (video) =>
      MediaProtocol.expiringUrl(video.uri, FILE_RETENTION, {
        mediaType: video.mimeType ?? "video/mp4",
        headers: context.auth,
      }),
  )
  const reasons = generated?.raiMediaFilteredReasons ?? []
  const notices = reasons.map((reason) => ({
    type: "filtered" as const,
    message: `${NAME} filtered media: ${reason}`,
    providerMetadata: { google: { raiMediaFilteredReason: reason } },
  }))
  if (videos.length === 0 && (reasons.length > 0 || (generated?.raiMediaFilteredCount ?? 0) > 0))
    return yield* output.contentPolicy(
      `${NAME} filtered every video${reasons.length === 0 ? "" : `: ${reasons.join("; ")}`}`,
    )
  if (videos.length === 0) return yield* output.invalid(`${NAME} operation completed without any video`)
  return new VideoResponse({
    videos,
    notices: notices.length === 0 ? undefined : notices,
    providerMetadata: {
      google: {
        operation: context.token.operation,
        raiMediaFilteredCount: generated?.raiMediaFilteredCount,
        metadata: operation.metadata,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const operationPath = (token: Token) => `/${token.operation}`

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>({
  id: ADAPTER,
  name: NAME,
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: operationPath, decode: decodeStatus },
  result: { path: operationPath, decode: decodeResult },
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<GoogleVideoOptions, Token>(
    {
      id: ADAPTER,
      provider: PROVIDER,
      protocol,
      baseURL: DEFAULT_BASE_URL,
      path: ({ request }) => `/models/${request.model.id}:predictLongRunning`,
    },
    input,
  )

export const GoogleVideo = {
  protocol,
  model,
} as const
