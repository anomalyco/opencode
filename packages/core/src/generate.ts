export * as Generate from "./generate"

import { LLM, LLMClient, LLMError } from "@opencode-ai/ai"
import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { ModelResolver } from "./model-resolver"
import { ModelV2 } from "./model"

export interface TextInput {
  readonly prompt: string
  readonly model?: ModelV2.Ref
}

export class ModelSelectionError extends Schema.TaggedErrorClass<ModelSelectionError>()(
  "Generate.ModelSelectionError",
  { message: Schema.String },
) {}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("Generate.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = ModelSelectionError | UnavailableError

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Generate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const resolver = yield* ModelResolver.Service

    const runText = Effect.fn("Generate.text")(function* (input: TextInput) {
      const resolved = yield* resolver.resolve(input.model).pipe(
        Effect.catchTags({
          "SessionRunnerModel.VariantUnavailableError": (error) =>
            input.model
              ? new ModelSelectionError({ message: error.message })
              : new UnavailableError({ message: error.message, service: error.providerID }),
          "SessionRunnerModel.UnsupportedPackageError": (error) =>
            input.model
              ? new ModelSelectionError({ message: error.message })
              : new UnavailableError({ message: error.message, service: error.providerID }),
        }),
      )
      if (!resolved)
        return yield* new ModelSelectionError({
          message: input.model
            ? `Model unavailable: ${input.model.providerID}/${input.model.id}`
            : "No model specified and no supported model is available",
        })
      const response = yield* llm.generate(LLM.request({ model: resolved.model, prompt: input.prompt })).pipe(
        Effect.mapError(
          (error: LLMError) =>
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
  deps: [ModelResolver.node, llmClient],
})
