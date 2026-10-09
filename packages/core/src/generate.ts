export * as Generate from "./generate.js"

import { LLM, LLMClient, AIError } from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "./effect/app-node-platform.js"
import { ModelResolver } from "./model-resolver.js"
import { Model } from "./model.js"
import { PluginHooks } from "./plugin/hooks.js"

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

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Generate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const resolver = yield* ModelResolver.Service
    const hooks = yield* PluginHooks.Service

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
      const requestID = SessionID.create()
      const scope = { requestID, model: resolved.ref }
      const hasHttpHooks =
        (yield* hooks.has("generate", "http.request", resolved.ref.providerID)) ||
        (yield* hooks.has("generate", "http.response", resolved.ref.providerID))
      const http: StreamOptions["http"] = hasHttpHooks
        ? (request, handler) =>
            Effect.gen(function* () {
              const before = yield* hooks.trigger("generate", "http.request", {
                ...scope,
                request: yield* HttpClientRequest.toWeb(request),
              })
              let sent = HttpClientRequest.fromWeb(before.request)
              if (before.request.body)
                sent = HttpClientRequest.bodyUint8Array(
                  sent,
                  new Uint8Array(yield* Effect.promise(() => before.request.clone().arrayBuffer())),
                  before.request.headers.get("content-type") ?? undefined,
                )
              const response = yield* handler(sent)
              const after = yield* hooks.trigger("generate", "http.response", {
                ...scope,
                request: before.request,
                response: new Response(
                  [204, 205, 304].includes(response.status)
                    ? null
                    : yield* Stream.toReadableStreamEffect(response.stream),
                  { status: response.status, headers: response.headers },
                ),
              })
              return HttpClientResponse.fromWeb(sent, after.response)
            }).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))))
        : undefined
      const response = yield* llm
        .generate(
          LLM.request({
            model: resolved.model,
            prompt: input.prompt,
            // Gateways require session attribution even for a stateless call; no Session is stored.
            http: { headers: { "x-opencode-session": requestID } },
          }),
          http ? { http } : undefined,
        )
        .pipe(
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

    return Service.of({ text })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ModelResolver.node, llmClient, PluginHooks.node],
})
