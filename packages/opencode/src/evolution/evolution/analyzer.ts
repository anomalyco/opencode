import { Effect, Layer, Context } from "effect"

// Phase 5: Session analysis — failure patterns, performance metrics, usage trends
export interface Interface {
  readonly analyze: () => Effect.Effect<{ sessions: number; patterns: string[] }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/EvolutionAnalyzer") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const analyze = Effect.fn("EvolutionAnalyzer.analyze")(function* () {
      return { sessions: 0, patterns: [] }
    })
    return Service.of({ analyze })
  }),
)

export const defaultLayer = layer

export * as EvolutionAnalyzer from "./analyzer"
