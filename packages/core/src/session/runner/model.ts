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
export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
    /** Waits for a background catalog refresh when the selected model is not in the boot snapshot. */
    awaitCatalog?: () => Effect.Effect<void>,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

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
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available, awaitCatalog) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        if (!session.model) {
          const agent = (yield* agents.select(session.agent)).info?.model
          const preferred =
            agent &&
            (yield* available()).find((model) => model.providerID === agent.providerID && model.id === agent.id)
          const resolved = preferred
            ? yield* resolver.resolveModel(preferred, agent.variant)
            : yield* resolver.resolve()
          if (resolved) return resolved
          return yield* new ModelNotSelectedError({ sessionID: session.id })
        }
        const model = session.model
        const find = (models: ReadonlyArray<Model.Info>) =>
          models.find((item) => item.providerID === model.providerID && item.id === model.id)
        const selected = find(yield* available())
        if (selected) return yield* resolver.resolveModel(selected, model.variant)
        if (!awaitCatalog)
          return yield* new ModelUnavailableError({ providerID: model.providerID, modelID: model.id })
        // The bundled catalog is only the boot floor; a model added since the last snapshot is
        // supplied by the initial refresh. Wait for that attempt, then give the provider catalog a
        // moment to apply it before reporting the selection as unavailable.
        yield* awaitCatalog().pipe(Effect.timeout("10 seconds"), Effect.ignore)
        const deadline = Date.now() + 1_000
        while (Date.now() < deadline) {
          const late = find(yield* available())
          if (late) return yield* resolver.resolveModel(late, model.variant)
          yield* Effect.sleep("25 millis")
        }
        return yield* new ModelUnavailableError({ providerID: model.providerID, modelID: model.id })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [ModelResolver.node, Agent.node] })
