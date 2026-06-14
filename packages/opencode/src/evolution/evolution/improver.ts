import { Effect, Layer, Context } from "effect"

// Phase 5: Self-improvement — config suggestions, agent prompt tuning, AGENTS.md updates
export interface Interface {
  readonly suggest: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionImprover") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const suggest = Effect.fn("EvolutionImprover.suggest")(function* () {
      return []
    })
    return Service.of({ suggest })
  }),
)

export const defaultLayer = layer

export * as EvolutionImprover from "./improver"
