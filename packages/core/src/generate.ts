export * as Generate from "./generate"

import { LLM, LLMClient, LLMError } from "@opencode-ai/llm"
import { Context, Effect, Layer, Schema } from "effect"
import { Catalog } from "./catalog"
import { makeLocationNode } from "./effect/app-node"
import { llmClient } from "./effect/app-node-platform"
import { Integration } from "./integration"
import { ModelV2 } from "./model"
import { SessionRunnerModel } from "./session/runner/model"

export interface TextInput {
  readonly prompt: string
  readonly model?: ModelV2.Ref
}

export class ModelSelectionError extends Schema.TaggedErrorClass<ModelSelectionError>()(
  "Generate.ModelSelectionError",
  { message: Schema.String },
) {}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()(
  "Generate.UnavailableError",
  { message: Schema.String, service: Schema.optional(Schema.String) },
) {}

export type Error = ModelSelectionError | UnavailableError

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Generate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const llm = yield* LLMClient.Service

    const selectModel = Effect.fn("Generate.selectModel")(function* (requested?: ModelV2.Ref) {
      const selected = requested
        ? yield* catalog.model.get(requested.providerID, requested.id)
        : yield* catalog.model.default().pipe(
            Effect.flatMap((model) =>
              model && SessionRunnerModel.supported(model)
                ? Effect.succeed(model)
                : Effect.map(catalog.model.available(), (models) => models.find(SessionRunnerModel.supported)),
            ),
          )
      if (!selected)
        return yield* new ModelSelectionError({
          message: requested
            ? `Model unavailable: ${requested.providerID}/${requested.id}`
            : "No model specified and no supported model is available",
        })
      return yield* SessionRunnerModel.withVariant(selected, requested?.variant).pipe(
        Effect.mapError(
          () =>
            new ModelSelectionError({
              message: `Variant unavailable for ${selected.providerID}/${selected.id}: ${requested?.variant}`,
            }),
        ),
      )
    })

    const runText = Effect.fn("Generate.text")(function* (input: TextInput) {
      const selected = yield* selectModel(input.model)
      const provider = yield* catalog.provider.get(selected.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(selected.providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const model = yield* SessionRunnerModel.fromCatalogModel(selected, credential).pipe(
        Effect.mapError((error) =>
          input.model
            ? new ModelSelectionError({ message: error.message })
            : new UnavailableError({ message: error.message, service: selected.providerID }),
        ),
      )
      const response = yield* llm.generate(LLM.request({ model, prompt: input.prompt })).pipe(
        Effect.mapError(
          (error: LLMError) =>
            new UnavailableError({
              message: error.message,
              service: selected.providerID,
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

export const node = makeLocationNode({ service: Service, layer, deps: [Catalog.node, Integration.node, llmClient] })
