import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/http"
import type { Status } from "../generation.js"
import { Media } from "../media.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { mergeJsonRecords, tokenUsage, type OpenString } from "../schema/index.js"
import { VideoModel, VideoResponse, seconds, type VideoRequest } from "../video.js"
import { GoogleInteractions } from "./google-interactions.js"
import { optionalNull } from "./shared.js"
import { GeminiGenerateContent } from "./utils/gemini-generate-content.js"
import { MediaInput } from "./utils/media-input.js"

const route = MediaProtocol.identity({
  id: "google-interactions-video",
  name: "Google Interactions Video",
  provider: "google",
})
export const DEFAULT_BASE_URL = GoogleInteractions.DEFAULT_BASE_URL
export const PATH = "/interactions"

// ---------------------------------------------------------------------------
// 1. Public model input
// ---------------------------------------------------------------------------

/**
 * Provider-native Interactions fields, merged into the body. Common fields (`start`, `end`, `references`,
 * `duration`, `aspect`, `resolution`) live on the request. Edit or extend a video by passing it as a reference with
 * `generation_config.video_config.task`, or continue a generated one with `previous_interaction_id`.
 */
export type GoogleVideoOptions = {
  readonly previous_interaction_id?: string
  readonly generation_config?: {
    readonly video_config?: {
      readonly task?: OpenString<"text_to_video" | "image_to_video" | "reference_to_video" | "edit" | "extend">
    } & Record<string, unknown>
  } & Record<string, unknown>
  readonly response_format?: { readonly delivery?: OpenString<"inline" | "uri"> } & Record<string, unknown>
  readonly service_tier?: OpenString<"flex" | "standard" | "priority">
  readonly webhook_config?: {
    readonly uris?: ReadonlyArray<string>
    readonly user_metadata?: Record<string, unknown>
  }
} & Record<string, unknown>

export type Request = VideoRequest<VideoModel<GoogleVideoOptions>>

// ---------------------------------------------------------------------------
// 2. Token and response schemas
// ---------------------------------------------------------------------------

/** The provider's job ID; it is all a later status, result or cancel call needs. */
export const Token = Schema.String
export type Token = Schema.Schema.Type<typeof Token>

const Content = Schema.Struct({
  type: Schema.String,
  data: optionalNull(Schema.String),
  uri: optionalNull(Schema.String),
  mime_type: optionalNull(Schema.String),
  text: optionalNull(Schema.String),
})

const Usage = Schema.StructWithRest(
  Schema.Struct({
    total_input_tokens: optionalNull(Schema.Number),
    total_output_tokens: optionalNull(Schema.Number),
    total_thought_tokens: optionalNull(Schema.Number),
    total_tokens: optionalNull(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const Interaction = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  model: optionalNull(Schema.String),
  steps: optionalNull(
    Schema.Array(Schema.Struct({ type: Schema.String, content: optionalNull(Schema.Array(Content)) })),
  ),
  usage: optionalNull(Usage),
  errors: optionalNull(
    Schema.Array(Schema.Struct({ code: optionalNull(Schema.String), message: optionalNull(Schema.String) })),
  ),
})

// `incomplete` is terminal ("completed, but contains incomplete results"); the result read decides whether a video
// came back. `requires_action` and `requires_continuation` are not documented for video and stay running.
const STATUS = {
  in_progress: "running",
  completed: "completed",
  incomplete: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<string, Status>

// ---------------------------------------------------------------------------
// 3. Failures
// ---------------------------------------------------------------------------

// Interaction error codes are documented only as "a URI that identifies the error type"; the last segment carries the
// canonical Google status name.
const FAILURE = {
  INVALID_ARGUMENT: "InvalidRequest",
  FAILED_PRECONDITION: "InvalidRequest",
  OUT_OF_RANGE: "InvalidRequest",
  PERMISSION_DENIED: "Authentication",
  UNAUTHENTICATED: "Authentication",
  RESOURCE_EXHAUSTED: "RateLimit",
} as const satisfies Record<string, MediaProtocol.Failure>

const errorCode = (code: string | null | undefined) =>
  code?.split("/").at(-1)?.trim().toUpperCase().replaceAll("-", "_") || undefined

// ---------------------------------------------------------------------------
// 5. Request body construction
// ---------------------------------------------------------------------------

// Omni has no role field for media: it reads one image as the start frame and two as start and end. The task hint
// pins that reading when only frames, or only references, are sent; with both, the prompt decides.
const task = (request: Request) => {
  const frames = request.start !== undefined || request.end !== undefined
  const references = (request.references ?? []).length > 0
  if (frames && !references) return "image_to_video"
  if (references && !frames) return "reference_to_video"
  return undefined
}

const fromRequest = Effect.fn("GoogleInteractionsVideo.fromRequest")(function* (request: Request) {
  if (request.end !== undefined && request.start === undefined)
    return yield* route.unsupported("video.end", `${route.name} reads a lone image as the start frame; send start too`)
  const media = yield* Effect.forEach(
    [request.start, request.end, ...(request.references ?? [])].filter(
      (asset): asset is Media.Asset => asset !== undefined,
    ),
    GoogleInteractions.mediaContent,
  )
  const responseFormat = {
    // `auto` follows the input image, which Omni expresses by leaving the ratio out.
    aspect_ratio: request.aspect === "auto" ? undefined : request.aspect,
    resolution: request.resolution?.toLowerCase(),
    duration: request.duration === undefined ? undefined : `${seconds(request.duration)}s`,
  }
  const videoTask = task(request)
  return MediaProtocol.json(
    mergeJsonRecords(
      {
        model: request.model.id,
        input: [...media, { type: "text", text: request.prompt }],
        background: true,
        response_format: Object.values(responseFormat).some((value) => value !== undefined)
          ? { type: "video", ...responseFormat }
          : undefined,
        generation_config: videoTask === undefined ? undefined : { video_config: { task: videoTask } },
      },
      request.providerOptions,
      request.http?.body,
    ) ?? {},
  )
})

// ---------------------------------------------------------------------------
// 6. Response decoding
// ---------------------------------------------------------------------------

const decodeStart = route.decodeStarted(Interaction, (value) => ({
  token: value.id,
  snapshot: { id: value.id, status: MediaProtocol.status(STATUS, value.status) },
}))

const decodeInteraction = route.decodeJson(Interaction)

const decodeStatus = Effect.fn("GoogleInteractionsVideo.decodeStatus")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeInteraction(response)
  return { id: context.token, status: MediaProtocol.status(STATUS, output.value.status) }
})

const decodeResult = Effect.fn("GoogleInteractionsVideo.decodeResult")(function* (
  response: HttpClientResponse.HttpClientResponse,
  context: MediaProtocol.PollContext<Token>,
) {
  const output = yield* decodeInteraction(response)
  const decoded = output.value
  const status = MediaProtocol.status(STATUS, decoded.status)
  if (status === "running") return yield* output.pending(context.token)
  const errors = decoded.errors ?? []
  const codes = errors.flatMap((error) => {
    const code = errorCode(error.code)
    return code === undefined ? [] : [code]
  })
  const messages = errors.flatMap((error) => (error.message?.trim() ? [error.message.trim()] : []))
  if (status === "cancelled")
    return yield* output.ended("cancelled", `${route.name} interaction ${context.token} was cancelled`)
  if (status === "failed") {
    const message = `${route.name} generation failed${codes.length === 0 ? "" : ` (${codes.join(", ")})`}${messages.length === 0 ? "" : `: ${messages.join("\n")}`}`
    if (codes.some((code) => code === "CONTENT_BLOCKED" || GeminiGenerateContent.contentFiltered(code)))
      return yield* output.contentPolicy(message)
    return yield* output.ended("failed", message, MediaProtocol.failure(FAILURE, codes[0]))
  }
  const contents = (decoded.steps ?? []).flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
  const videos = yield* Effect.forEach(
    contents.filter((content) => content.type === "video"),
    (content, index) => {
      const mediaType = content.mime_type ?? undefined
      if (content.data)
        return MediaInput.decodedAsset(output.invalid, `${route.name} video ${index}`, content.data, mediaType)
      // `GET /interactions/{id}` documents inline data even for `delivery: "uri"`; a Files API URI needs the API key
      // to download, so it stays a Google reference that can be passed back as input.
      if (content.uri) return Effect.succeed(Media.ref(route.provider, content.uri, mediaType))
      return Effect.fail(output.invalid(`${route.name} returned a video without data or a URI`))
    },
  )
  if (videos.length === 0) {
    if (codes.some((code) => code === "CONTENT_BLOCKED" || GeminiGenerateContent.contentFiltered(code)))
      return yield* output.contentPolicy(
        `${route.name} withheld the video${messages.length === 0 ? "" : `: ${messages.join("\n")}`}`,
      )
    return yield* output.invalid(`${route.name} ${decoded.status} without a video`)
  }
  const usage = decoded.usage ?? undefined
  return new VideoResponse({
    videos,
    usage:
      usage === undefined
        ? undefined
        : tokenUsage({
            input: usage.total_input_tokens ?? undefined,
            output: usage.total_output_tokens ?? undefined,
            total: usage.total_tokens ?? undefined,
            details: { reasoningTokens: usage.total_thought_tokens ?? undefined, google: usage },
          }),
    providerMetadata: {
      google: {
        interactionId: decoded.id,
        model: decoded.model ?? undefined,
        status: decoded.status,
      },
    },
  })
})

// ---------------------------------------------------------------------------
// 7. Protocol and route
// ---------------------------------------------------------------------------

const interactionPath = (token: Token) => `${PATH}/${encodeURIComponent(token)}`

export const protocol = MediaProtocol.queued<Request, VideoResponse, Token>(route, {
  token: Token,
  start: { body: { from: fromRequest }, decode: decodeStart },
  status: { path: interactionPath, decode: decodeStatus },
  result: { path: interactionPath, decode: decodeResult },
  cancel: { method: "POST", path: (token) => `${interactionPath(token)}/cancel` },
})

export const model = (input: MediaRoute.ModelInput) =>
  VideoModel.fromRoute<GoogleVideoOptions>({ protocol, baseURL: DEFAULT_BASE_URL, path: PATH }, input)

export const GoogleInteractionsVideo = {
  protocol,
  model,
} as const
