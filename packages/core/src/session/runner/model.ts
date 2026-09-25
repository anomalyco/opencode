export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "../../agent.js"
import { ModelResolver } from "../../model-resolver.js"
import { SessionSchema } from "../schema.js"

export class ModelNotSelectedError extends Schema.TaggedError<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: Model.ID },
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
export const ModelConfigurationError = ModelResolver.ModelConfigurationError
export type ModelConfigurationError = ModelResolver.ModelConfigurationError
export const ModelInitializationError = ModelResolver.ModelInitializationError
export type ModelInitializationError = ModelResolver.ModelInitializationError
export const UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError
export type UnresolvedProviderVariablesError = ModelResolver.UnresolvedProviderVariablesError
export const UnsupportedCompactionError = ModelResolver.UnsupportedCompactionError
export type UnsupportedCompactionError = ModelResolver.UnsupportedCompactionError

export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

// "default" is the stored sentinel for an unset variant, not a catalog id.
export function requestVariant(
  requested: Model.Ref | undefined,
  selected: { readonly providerID: Provider.ID; readonly id: Model.ID },
  agentModel: Model.Ref | undefined,
) {
  if (requested?.variant && requested.variant !== "default") return requested.variant
  if (
    agentModel?.variant &&
    agentModel.variant !== "default" &&
    agentModel.providerID === selected.providerID &&
    agentModel.id === selected.id
  )
    return agentModel.variant
  return requested?.variant
}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Model.Capabilities
    readonly variant?: Model.VariantID
    readonly cost: Model.Info["cost"]
    readonly limit: Model.Info["limit"]
    readonly compaction?: Provider.Compaction
    readonly transport?: Provider.Transport
  },
): Resolved => ({
  model,
  ref: Model.Ref.make({
    id: Model.ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
  limit: options.limit,
  compaction: options.compaction,
  transport: options.transport,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const agents = yield* Agent.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available) {
        const agent = yield* agents.resolve(session.agent)
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        if (!session.model) {
          const selected = yield* resolver.select()
          if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
          return yield* resolver.resolveModel(selected, requestVariant(undefined, selected, agent?.model))
        }
        const selected = (yield* available()).find(
          (model) => model.providerID === session.model?.providerID && model.id === session.model.id,
        )
        if (!selected)
          return yield* new ModelUnavailableError({
            providerID: session.model.providerID,
            modelID: session.model.id,
          })
        return yield* resolver.resolveModel(selected, requestVariant(session.model, selected, agent?.model))
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [ModelResolver.node, Agent.node] })
