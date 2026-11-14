export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai/effect"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Context, Effect, Layer, Schema } from "effect"
import type { SessionRequestKind } from "@opencode/plugin/effect/session"
import { Agent } from "../../agent.js"
import { ModelAvailability } from "../../model-availability.js"
import { ModelResolver } from "../../model-resolver.js"
import { PluginHooks } from "../../plugin/hooks.js"
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

/** Why a blocked model could not be substituted. */
export const BlockedReason = Schema.Literals([
  "no-fallback",
  "fallback-not-found",
  "cycle-detected",
  "depth-exceeded",
  "malformed-fallback",
])
export type BlockedReason = typeof BlockedReason.Type

const blockedMessage = (
  providerID: Provider.ID,
  modelID: Model.ID,
  reason: BlockedReason,
  detail: { readonly fallback?: string; readonly limit?: number },
): string => {
  const model = `${providerID}/${modelID}`
  switch (reason) {
    case "no-fallback":
      return `Model ${model} is outside its availability window and no fallback model is configured`
    case "fallback-not-found":
      return `Model ${model} is outside its availability window and its fallback ${detail.fallback} is not a known model`
    case "cycle-detected":
      return `Model ${model} is outside its availability window and its fallback chain contains a cycle at ${detail.fallback}`
    case "depth-exceeded":
      return `Model ${model} is outside its availability window and its fallback chain exceeds the maximum of ${detail.limit} hops`
    case "malformed-fallback":
      return `Model ${model} is outside its availability window and its fallback ${JSON.stringify(detail.fallback ?? "")} is not a valid provider/model reference`
  }
}

/** A time window in the model's `availability` config currently blocks it and no usable fallback is configured. */
export class ModelBlockedByAvailabilityError extends Schema.TaggedError<ModelBlockedByAvailabilityError>()(
  "SessionRunnerModel.ModelBlockedByAvailabilityError",
  { providerID: Provider.ID, modelID: Model.ID, reason: BlockedReason, fallback: Schema.String.pipe(Schema.optional) },
) {
  override get message() {
    return blockedMessage(this.providerID, this.modelID, this.reason, { fallback: this.fallback })
  }
}
export type Error =
  | ModelNotSelectedError
  | ModelUnavailableError
  | ModelBlockedByAvailabilityError
  | ModelAvailability.TimezoneError
  | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
    request: { readonly kind: SessionRequestKind; readonly agent: Agent.ID },
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const agents = yield* Agent.Service
    const hooks = yield* PluginHooks.Service
    // Location plugins populate and filter the catalog asynchronously during layer startup.
    type Selection = { readonly info: Model.Info; readonly variant: Model.VariantID | undefined }
    type SelectionError = ModelBlockedByAvailabilityError | ModelAvailability.TimezoneError
    // Resolves a model, substituting its configured fallback while an availability window blocks it.
    // Fallback chains are followed transitively (a fallback may itself be blocked) up to a fixed depth,
    // with cycles reported explicitly via a visited set of provider/model identities.
    const pick =
      (find: (ref: Model.Ref) => Effect.Effect<Model.Info | undefined>) => {
        const blocked = (
          info: Model.Info,
          reason: BlockedReason,
          fallback?: string,
        ): ModelBlockedByAvailabilityError =>
          new ModelBlockedByAvailabilityError({
            providerID: info.providerID,
            modelID: info.id,
            reason,
            ...(fallback === undefined ? {} : { fallback }),
          })
        return function choose(
          info: Model.Info,
          variant: Model.VariantID | undefined,
          depth = 0,
          visited = new Set<string>([`${info.providerID}/${info.id}`]),
        ): Effect.Effect<Selection, SelectionError> {
          return Effect.gen(function* () {
            if (yield* ModelAvailability.check(info)) return { info, variant }
            const fallback = info.availability?.fallback
            if (fallback === undefined) return yield* blocked(info, "no-fallback")
            // Catalog-injected models bypass config decoding, so a malformed fallback ref is a
            // config error, not a defect: surface a blocked-model error naming the bad ref.
            const ref = yield* Effect.try({
              try: () => Model.Ref.parse(fallback),
              catch: () => blocked(info, "malformed-fallback", fallback),
            })
            if (ref === undefined) return yield* blocked(info, "malformed-fallback", fallback)
            const identity = `${ref.providerID}/${ref.id}`
            if (visited.has(identity)) return yield* blocked(info, "cycle-detected", fallback)
            const next = yield* find(ref)
            if (next === undefined) return yield* blocked(info, "fallback-not-found", fallback)
            if (depth >= 3) return yield* blocked(info, "depth-exceeded", fallback)
            yield* Effect.logInfo("model blocked by availability window, using fallback", {
              provider: info.providerID,
              model: info.id,
              fallback,
            })
            return yield* choose(next, ref.variant, depth + 1, new Set(visited).add(identity))
          })
        }
      }
    const select = Effect.fn("SessionRunnerModel.select")(function* (
      session: SessionSchema.Info,
      available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
    ) {
      const find = (ref: Model.Ref) =>
        available().pipe(
          Effect.map((models) => models.find((model) => model.providerID === ref.providerID && model.id === ref.id)),
        )
      const choose = pick(find)
      if (session.model) {
        const info = yield* find(session.model)
        if (info) return yield* choose(info, session.model.variant)
        return yield* new ModelUnavailableError({ providerID: session.model.providerID, modelID: session.model.id })
      }
      const agent = (yield* agents.select(session.agent)).info?.model
      const preferred = agent && (yield* find(agent))
      if (preferred) return yield* choose(preferred, agent!.variant)
      const info = yield* resolver.fallback()
      if (info) return yield* choose(info, undefined)
      return yield* new ModelNotSelectedError({ sessionID: session.id })
    })
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available, request) {
        const selected = yield* select(session, available)
        const ref = Model.Ref.make({
          providerID: selected.info.providerID,
          id: selected.info.id,
          ...(selected.variant === undefined ? {} : { variant: selected.variant }),
        })
        const model = (yield* hooks.trigger("session", "experimental.model.resolve", {
          sessionID: session.id,
          agent: request.agent,
          kind: request.kind,
          model: ref,
        })).model
        if (model.providerID === ref.providerID && model.id === ref.id && model.variant === ref.variant)
          return yield* resolver.resolveModel(selected.info, selected.variant)
        // Same provider only: the model may be hidden from the picker, and its credentials and hooks stay the selection's.
        const resolved = model.providerID === ref.providerID ? yield* resolver.resolve(model) : undefined
        if (resolved) return resolved
        return yield* new ModelUnavailableError({ providerID: model.providerID, modelID: model.id })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ModelResolver.node, Agent.node, PluginHooks.node],
})
