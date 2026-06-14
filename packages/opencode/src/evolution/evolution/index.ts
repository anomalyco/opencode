import { Effect, Layer, Context } from "effect"

export interface Interface {
  readonly analyzeSessions: () => Effect.Effect<{ sessions: number; patterns: string[] }>
  readonly suggestImprovements: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionSystem") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const analyzeSessions = Effect.fn("EvolutionSystem.analyzeSessions")(function* () {
      return { sessions: 0, patterns: [] }
    })

    const suggestImprovements = Effect.fn("EvolutionSystem.suggestImprovements")(function* () {
      return []
    })

    return Service.of({ analyzeSessions, suggestImprovements })
  }),
)

export const defaultLayer = layer

export * as EvolutionSystem from "."
