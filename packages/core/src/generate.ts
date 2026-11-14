export * as Generate from "./generate.js"

import {
  ai,
  AIError,
  DecisionClient,
  ImageClient,
  LLMClient,
  Media,
  VideoClient,
  type VideoAspectRatio,
  type VideoStatus,
} from "@opencode/ai/effect"
import type { DecisionRequest, DecisionResult, ImageRequest, ImageResult } from "@opencode/schema/generate"
import { Money } from "@opencode/schema/money"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer, Schema } from "effect"
import { RequestExecutor } from "@opencode/ai/route"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient, requestExecutor } from "./effect/app-node-platform.js"
import { Integration } from "./integration.js"
import { ModelResolver } from "./model-resolver.js"
import { Model } from "./model.js"
import { ModelRetry } from "./model-retry.js"

export interface TextInput {
  readonly prompt: string
  readonly model?: Model.Ref
}

export interface VideoInput {
  readonly model: Model.Ref
  readonly prompt: string
  readonly start?: Media.ImageAsset
  readonly end?: Media.ImageAsset
  readonly references?: readonly Media.Asset[]
  readonly duration?: number
  readonly aspect?: VideoAspectRatio
  readonly resolution?: string
  readonly sound?: boolean
}

/** A submitted video job. Store `id`, the provider's job ID, to read the job later from any process. */
export interface VideoJob {
  readonly id: string
}

export interface VideoFile {
  readonly data: Uint8Array
  readonly mime: string
}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Generate.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()("Generate.ModelNotFoundError", {
  providerID: Schema.String,
  modelID: Schema.String,
  message: Schema.String,
}) {}

/** The model exists but cannot serve this request, such as a chat model asked for images. */
export class UnsupportedModelError extends Schema.TaggedError<UnsupportedModelError>()(
  "Generate.UnsupportedModelError",
  {
    providerID: Schema.String,
    modelID: Schema.String,
    capability: Schema.String,
    message: Schema.String,
  },
) {}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()("Generate.InvalidRequestError", {
  message: Schema.String,
  field: Schema.optional(Schema.String),
}) {}

export const ProviderFailure = Schema.Literals([
  "authentication",
  "rate_limit",
  "content_filter",
  "invalid_request",
  "overloaded",
  "provider",
])

/** The provider rejected or failed the request after it was sent. */
export class ProviderRequestError extends Schema.TaggedError<ProviderRequestError>()("Generate.ProviderRequestError", {
  providerID: Schema.String,
  reason: ProviderFailure,
  message: Schema.String,
  status: Schema.optional(Schema.Int),
  retryAfterMs: Schema.optional(Schema.Int),
}) {}

export type Error =
  | ModelNotFoundError
  | UnsupportedModelError
  | InvalidRequestError
  | ProviderRequestError
  | UnavailableError

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
  readonly image: (input: ImageRequest) => Effect.Effect<ImageResult, Error>
  readonly decisions: (input: DecisionRequest) => Effect.Effect<DecisionResult, Error>
  /** Video generation is a job: `start` submits it, and the caller reads it back by job ID until it settles. */
  readonly video: {
    readonly start: (input: VideoInput) => Effect.Effect<VideoJob, Error>
    readonly status: (model: Model.Ref, id: string) => Effect.Effect<VideoStatus, Error>
    /** The finished video, downloaded. Fails while the job is still running, or with the reason it failed. */
    readonly result: (model: Model.Ref, id: string) => Effect.Effect<VideoFile, Error>
    /** Fails with `InvalidRequestError` when the provider has no way to cancel a job. */
    readonly cancel: (model: Model.Ref, id: string) => Effect.Effect<void, Error>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Generate") {}

// Image and decision clients are built here, on the shared request executor, so only Generate depends on them.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const resolver = yield* ModelResolver.Service
    const models = yield* Model.Service
    const executor = yield* RequestExecutor.Service
    const images = yield* ImageClient.Service
    const decisionClient = yield* DecisionClient.Service
    const videos = yield* VideoClient.Service

    const runText = Effect.fn("Generate.text")(function* (input: TextInput) {
      const resolved = yield* resolver
        .resolve(input.model)
        .pipe(
          Effect.catchTag(
            [
              "SessionRunnerModel.VariantUnavailableError",
              "SessionRunnerModel.UnsupportedPackageError",
              "SessionRunnerModel.ModelConfigurationError",
              "SessionRunnerModel.ModelInitializationError",
              "SessionRunnerModel.UnresolvedProviderVariablesError",
              "SessionRunnerModel.UnsupportedCompactionError",
            ],
            (error) =>
              Effect.fail(
                input.model
                  ? resolutionError(input.model, "chat", error)
                  : new UnavailableError({ message: error.message, service: error.providerID }),
              ),
          ),
        )
      if (!resolved && input.model) return yield* missing(input.model, "chat")
      if (!resolved)
        return yield* new UnavailableError({ message: "No model specified and no supported model is available" })
      const response = yield* llm
        .generate(
          ai.request({
            model: resolved.model,
            prompt: input.prompt,
            // Gateways require session attribution even for a stateless call; no Session is stored.
            headers: { "x-opencode-session": SessionID.create() },
          }),
        )
        .pipe(
          ModelRetry.retryOneShot,
          Effect.mapError((error) => providerError(resolved.ref, error)),
        )
      return response.text
    })

    // A ref no model of this type has: another type's model (422) or no model at all (404).
    const missing = Effect.fnUntraced(function* (ref: Model.Ref, type: Model.Type) {
      const other = (yield* models.available(["chat", "image", "video", "decision"])).find(
        (model) => model.providerID === ref.providerID && model.id === ref.id,
      )
      if (other)
        return yield* new UnsupportedModelError({
          providerID: ref.providerID,
          modelID: ref.id,
          capability: type,
          message: `${ref.providerID}/${ref.id} is a ${other.type ?? "chat"} model, not a ${type} model`,
        })
      return yield* new ModelNotFoundError({
        providerID: ref.providerID,
        modelID: ref.id,
        message: `Model not found: ${ref.providerID}/${ref.id}`,
      })
    })

    const image = Effect.fn("Generate.image")(function* (input: ImageRequest) {
      const model = yield* resolver
        .resolveImage(input.model)
        .pipe(Effect.mapError((error) => resolutionError(input.model, "image", error)))
      if (!model) return yield* missing(input.model, "image")
      // `ai.image.generate` turns an invalid request into a typed error; building it with `ai.image.request` would throw.
      const response = yield* ai.image
        .generate({
          model,
          prompt: input.prompt,
          images: input.images?.map((file) => Media.base64(file.data, file.mime)),
          n: input.n,
          aspect: input.aspect,
          resolution: input.resolution,
        })
        .pipe(
          Effect.provideService(ImageClient.Service, images),
          ModelRetry.retryOneShot,
          Effect.mapError((error) => providerError(input.model, error)),
        )
      // URL results are downloaded so every image comes back inline, like the request's own files.
      // Materializing also detects the type of a downloaded image from its bytes when the URL didn't say.
      const outputs = yield* Effect.forEach(response.images, (asset) =>
        asset.materialize().pipe(
          Effect.flatMap((image) =>
            image.base64().pipe(Effect.map((data) => ({ type: "image" as const, data, mime: image.mediaType }))),
          ),
          Effect.provideService(RequestExecutor.Service, executor),
          Effect.mapError((error) => providerError(input.model, error)),
        ),
      )
      const usage = response.usage?.type === "tokens" ? response.usage : undefined
      return {
        images: outputs,
        ...(usage?.input === undefined && usage?.output === undefined
          ? {}
          : { tokens: { input: usage.input, output: usage.output } }),
        ...(response.providerMetadata ? { native: plainJson(response.providerMetadata) } : {}),
      } satisfies ImageResult
    })

    const decisions = Effect.fn("Generate.decisions")(function* (input: DecisionRequest) {
      const model = yield* resolver
        .resolveDecision(input.model)
        .pipe(Effect.mapError((error) => resolutionError(input.model, "decision", error)))
      if (!model) return yield* missing(input.model, "decision")
      const response = yield* ai.decision
        .generate({
          model,
          input: input.input.map((part) =>
            part.type === "file"
              ? { type: "media" as const, media: Media.base64(part.data, part.mime), filename: part.name }
              : part,
          ),
          questions: input.questions,
        })
        .pipe(
          Effect.provideService(DecisionClient.Service, decisionClient),
          ModelRetry.retryOneShot,
          Effect.mapError((error) => providerError(input.model, error)),
        )
      const usage = response.usage
      return {
        answers: response.answers,
        ...(usage?.cost === undefined ? {} : { cost: Money.USD.make(usage.cost) }),
        ...(usage?.inputTokens === undefined && usage?.outputTokens === undefined
          ? {}
          : { tokens: { input: usage.inputTokens, output: usage.outputTokens } }),
        ...(response.providerMetadata ? { native: plainJson(response.providerMetadata) } : {}),
      } satisfies DecisionResult
    })

    const videoModel = Effect.fnUntraced(function* (ref: Model.Ref) {
      const model = yield* resolver
        .resolveVideo(ref)
        .pipe(Effect.mapError((error) => resolutionError(ref, "video", error)))
      if (!model) return yield* missing(ref, "video")
      return model
    })

    // Submitting is paid and not idempotent, so it is never retried; status and result reads retry in the route.
    const videoStart = Effect.fn("Generate.video.start")(function* (input: VideoInput) {
      const model = yield* videoModel(input.model)
      return yield* ai.video
        .start({
          model,
          prompt: input.prompt,
          start: input.start,
          end: input.end,
          references: input.references,
          duration: input.duration === undefined ? undefined : (`${input.duration} seconds` as const),
          aspect: input.aspect,
          resolution: input.resolution,
          sound: input.sound,
        })
        .pipe(
          Effect.provideService(VideoClient.Service, videos),
          Effect.mapError((error) => providerError(input.model, error)),
        )
    })

    const videoStatus = Effect.fn("Generate.video.status")(function* (ref: Model.Ref, id: string) {
      const model = yield* videoModel(ref)
      return yield* ai.video.status(model, id).pipe(
        Effect.provideService(VideoClient.Service, videos),
        Effect.mapError((error) => providerError(ref, error)),
      )
    })

    const videoResult = Effect.fn("Generate.video.result")(function* (ref: Model.Ref, id: string) {
      const model = yield* videoModel(ref)
      const response = yield* ai.video.result(model, id).pipe(
        Effect.provideService(VideoClient.Service, videos),
        Effect.mapError((error) => providerError(ref, error)),
      )
      const video = response.video
      if (!video)
        return yield* new ProviderRequestError({
          providerID: ref.providerID,
          reason: "provider",
          message: `${ref.providerID}/${ref.id} returned no video`,
        })
      // Results are usually URLs that expire, so the video is downloaded right away.
      const data = yield* video.bytes().pipe(
        Effect.provideService(RequestExecutor.Service, executor),
        Effect.mapError((error) => providerError(ref, error)),
      )
      return { data, mime: video.mediaType } satisfies VideoFile
    })

    const videoCancel = Effect.fn("Generate.video.cancel")(function* (ref: Model.Ref, id: string) {
      const model = yield* videoModel(ref)
      yield* ai.video.cancel(model, id).pipe(
        Effect.provideService(VideoClient.Service, videos),
        Effect.mapError((error) => providerError(ref, error)),
      )
    })

    const credentials = <A, E, R>(effect: Effect.Effect<A, E | Integration.AuthorizationError, R>) =>
      effect.pipe(
        Effect.catchTag(
          "Integration.Authorization",
          () => new UnavailableError({ message: "Generation credentials are unavailable" }),
        ),
      )

    return Service.of({
      text: (input) => credentials(runText(input)),
      image: (input) => credentials(image(input)),
      decisions: (input) => credentials(decisions(input)),
      video: {
        start: (input) => credentials(videoStart(input)),
        status: (model, id) => credentials(videoStatus(model, id)),
        result: (model, id) => credentials(videoResult(model, id)),
        cancel: (model, id) => credentials(videoCancel(model, id)),
      },
    })
  }),
).pipe(Layer.provide([ImageClient.layer, DecisionClient.layer, VideoClient.layer]))

// Provider metadata may hold undefined fields, which the JSON response schema rejects.
function plainJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value))
}

function resolutionError(ref: Model.Ref, type: string, error: ModelResolver.Error) {
  if (error._tag === "Integration.Authorization") return error
  if (error._tag === "SessionRunnerModel.VariantUnavailableError")
    return new InvalidRequestError({ message: error.message, field: "model.variant" })
  if (error._tag === "SessionRunnerModel.UnsupportedPackageError")
    return new UnsupportedModelError({
      providerID: ref.providerID,
      modelID: ref.id,
      capability: type,
      message: `${ref.providerID}/${ref.id} has no ${type} API opencode can call (package ${error.package})`,
    })
  return new InvalidRequestError({ message: error.message, field: "model" })
}

function providerError(ref: Model.Ref, error: AIError) {
  const reason = error.reason
  if (reason._tag === "InvalidRequest" && reason.http === undefined)
    return new InvalidRequestError({ message: reason.message })
  if (reason._tag === "UnsupportedOperation") return new InvalidRequestError({ message: reason.message })
  const status = "http" in reason ? reason.http?.status : undefined
  const retryAfterMs = "retryAfterMs" in reason ? reason.retryAfterMs : undefined
  return new ProviderRequestError({
    providerID: ref.providerID,
    reason: failureReason(reason._tag, status),
    message: reason.message,
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

function failureReason(tag: AIError["reason"]["_tag"], status: number | undefined): typeof ProviderFailure.Type {
  if (tag === "Authentication") return "authentication"
  if (tag === "RateLimit" || tag === "QuotaExceeded") return "rate_limit"
  if (tag === "ContentPolicy") return "content_filter"
  if (tag === "InvalidRequest") return "invalid_request"
  if (tag === "ProviderInternal" && (status === 503 || status === 529)) return "overloaded"
  return "provider"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ModelResolver.node, Model.node, llmClient, requestExecutor],
})
