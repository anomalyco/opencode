export * as Generate from "./generate.js"

import { AIError, Decision, DecisionClient, Image, ImageClient, LLM, LLMClient, Media } from "@opencode/ai/effect"
import type { DecisionRequest, DecisionResult, ImageRequest, ImageResult } from "@opencode/schema/generate"
import { Money } from "@opencode/schema/money"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
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

export class ModelSelectionError extends Schema.TaggedError<ModelSelectionError>()("Generate.ModelSelectionError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Generate.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = ModelSelectionError | UnavailableError

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

export type MediaError =
  | ModelNotFoundError
  | UnsupportedModelError
  | InvalidRequestError
  | ProviderRequestError
  | UnavailableError

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
  readonly image: (input: ImageRequest) => Effect.Effect<ImageResult, MediaError>
  readonly decisions: (input: DecisionRequest) => Effect.Effect<DecisionResult, MediaError>
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

    const runText = Effect.fn("Generate.text")(function* (input: TextInput) {
      const resolved = yield* resolver.resolve(input.model).pipe(
        Effect.catchTag(
          [
            "SessionRunnerModel.VariantUnavailableError",
            "SessionRunnerModel.UnsupportedPackageError",
            "SessionRunnerModel.ModelConfigurationError",
            "SessionRunnerModel.ModelInitializationError",
            "SessionRunnerModel.UnresolvedProviderVariablesError",
            "SessionRunnerModel.UnsupportedCompactionError",
          ],
          (error) => {
            const mapped: Error = input.model
              ? new ModelSelectionError({ message: error.message })
              : new UnavailableError({ message: error.message, service: error.providerID })
            return Effect.fail(mapped)
          },
        ),
      )
      if (!resolved)
        return yield* new ModelSelectionError({
          message: input.model
            ? `Model unavailable: ${input.model.providerID}/${input.model.id}`
            : "No model specified and no supported model is available",
        })
      const response = yield* llm
        .generate(
          LLM.request({
            model: resolved.model,
            prompt: input.prompt,
            // Gateways require session attribution even for a stateless call; no Session is stored.
            http: { headers: { "x-opencode-session": SessionID.create() } },
          }),
        )
        .pipe(
          ModelRetry.retry,
          Effect.mapError(
            (error: AIError) =>
              new UnavailableError({
                message: error.message,
                service: resolved.ref.providerID,
              }),
          ),
        )
      return response.text
    })

    const text: Interface["text"] = (input) =>
      runText(input).pipe(
        Effect.catchTag(
          "Integration.Authorization",
          () =>
            new UnavailableError({
              message: "Generation credentials are unavailable",
            }),
        ),
      )

    // Looks up a model of one type, or explains why the ref can't serve it: unknown (404) or another type (422).
    const resolveMedia = Effect.fnUntraced(function* <Runtime>(
      ref: Model.Ref,
      type: "image" | "decision",
      resolve: (
        ref: Model.Ref,
      ) => Effect.Effect<ModelResolver.ResolvedMedia<Runtime> | undefined, ModelResolver.MediaError>,
    ) {
      const resolved = yield* resolve(ref).pipe(Effect.mapError((error) => resolutionError(ref, type, error)))
      if (resolved) return resolved
      const other = (yield* models.available(["chat", "image", "decision"])).find(
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
      const resolved = yield* resolveMedia(input.model, "image", resolver.resolveImage)
      const response = yield* Image.generate({
        model: resolved.model,
        prompt: input.prompt,
        images: input.images?.map((file) => Media.base64(file.data, file.mime)),
        n: input.n,
        aspect: input.aspect as Media.AspectRatio | undefined,
        resolution: input.resolution,
      }).pipe(
        Effect.provideService(ImageClient.Service, images),
        retryRateLimits,
        Effect.mapError((error) => providerError(input.model, error)),
      )
      // URL results are downloaded so every image comes back inline, like the request's own files.
      const outputs = yield* Effect.forEach(response.images, (asset) =>
        asset.base64().pipe(
          Effect.map((data) => ({ type: "image" as const, data, mime: asset.mediaType })),
          Effect.provideService(RequestExecutor.Service, executor),
          Effect.mapError((error) => providerError(input.model, error)),
        ),
      )
      const usage = response.usage?.type === "tokens" ? response.usage : undefined
      return {
        images: outputs,
        ...(usage ? { tokens: { input: usage.input, output: usage.output } } : {}),
        ...(response.providerMetadata ? { native: response.providerMetadata } : {}),
      } satisfies ImageResult
    })

    const decisions = Effect.fn("Generate.decisions")(function* (input: DecisionRequest) {
      const resolved = yield* resolveMedia(input.model, "decision", resolver.resolveDecision)
      const response = yield* Decision.generate({
        model: resolved.model,
        input: input.input.map((part) =>
          part.type === "file"
            ? { type: "media" as const, media: Media.base64(part.data, part.mime), filename: part.name }
            : part,
        ),
        questions: input.questions,
      }).pipe(
        Effect.provideService(DecisionClient.Service, decisionClient),
        retryRateLimits,
        Effect.mapError((error) => providerError(input.model, error)),
      )
      const usage = response.usage
      return {
        answers: response.answers,
        ...(usage?.cost === undefined ? {} : { cost: Money.USD.make(usage.cost) }),
        ...(usage?.inputTokens === undefined && usage?.outputTokens === undefined
          ? {}
          : { tokens: { input: usage.inputTokens, output: usage.outputTokens } }),
        ...(response.providerMetadata ? { native: response.providerMetadata } : {}),
      } satisfies DecisionResult
    })

    const credentials = <A, E, R>(effect: Effect.Effect<A, E | Integration.AuthorizationError, R>) =>
      effect.pipe(
        Effect.catchTag(
          "Integration.Authorization",
          () => new UnavailableError({ message: "Generation credentials are unavailable" }),
        ),
      )

    return Service.of({
      text,
      image: (input) => credentials(image(input)),
      decisions: (input) => credentials(decisions(input)),
    })
  }),
).pipe(Layer.provide([ImageClient.layer, DecisionClient.layer]))

// Only a request the provider never accepted is retried: an image or decision call can be billed per attempt.
const retryRateLimits = <A, R>(effect: Effect.Effect<A, AIError, R>) =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.exponential("2 seconds"),
      times: 3,
      while: (error) => error.reason._tag === "RateLimit",
    }),
  )

function resolutionError(ref: Model.Ref, type: string, error: ModelResolver.MediaError) {
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
