export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { LanguageModel } from "@opencode-ai/ai"
import { Context, Effect, Layer, Schema } from "effect"
import { Catalog } from "../../catalog.js"
import { ModelResolver } from "../../model-resolver.js"
import { Capabilities, ID, Info, Ref, VariantID } from "../../model.js"
import { Provider } from "../../provider.js"
import { SessionSchema } from "../schema.js"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedErrorClass<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: ID },
) {
  override get message() {
    if (this.providerID === "azure-cognitive-services")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use azure/${this.modelID} instead.`
    if (this.providerID === "google-vertex-anthropic")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use google-vertex/${this.modelID} instead.`
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}
export const VariantUnavailableError = ModelResolver.VariantUnavailableError
export type VariantUnavailableError = ModelResolver.VariantUnavailableError
export const UnsupportedPackageError = ModelResolver.UnsupportedPackageError
export type UnsupportedPackageError = ModelResolver.UnsupportedPackageError
export const UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError
export type UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError

export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Capabilities
    readonly variant?: VariantID
    readonly cost: Info["cost"]
  },
): Resolved => ({
  model,
  ref: Ref.make({
    id: ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const resolver = yield* ModelResolver.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        if (!session.model) {
          const resolved = yield* resolver.resolve()
          if (resolved) return resolved
          return yield* new ModelNotSelectedError({ sessionID: session.id })
        }
        const selected = (yield* catalog.model.available()).find(
          (model) => model.providerID === session.model?.providerID && model.id === session.model.id,
        )
        if (!selected)
          return yield* new ModelUnavailableError({
            providerID: session.model.providerID,
            modelID: session.model.id,
          })
        return yield* resolver.resolveModel(selected, session.model.variant)
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Catalog.node, ModelResolver.node] })
