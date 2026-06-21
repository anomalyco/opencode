import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Option } from "effect"
import { Config } from "@/config/config"
import { InfoEvolutionSchema } from "@opencode-ai/core/v1/config/config"
import { EvolutionBrain } from "./brain"
import { EvolutionProject } from "./brain/project"
import { EvolutionMemory } from "./brain/memory"
import { EvolutionDecisions } from "./brain/decisions"
import { EvolutionStorageError } from "./error"

export { EvolutionBrain } from "./brain"
export { EvolutionMemory } from "./brain/memory"
export { EvolutionDecisions } from "./brain/decisions"
export { EvolutionProject } from "./brain/project"

export const ConfigEvolution = Schema.Struct({
  ...InfoEvolutionSchema.fields,
  validation: Schema.optional(Schema.Struct({
    timeoutMs: Schema.optional(Schema.Int).annotate({
      description: "Maximum time (ms) for Tier 2 validation before automatic REJECTED/VALIDATION_TIMEOUT (default: 5000)",
    }),
  })).annotate({
    description: "Validation pipeline configuration",
  }),
  minCandidateConfidence: Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))).annotate({
    description: "Minimum confidence score (0.0–1.0) for a candidate to be considered. All below → BELOW_THRESHOLD (default: 0.3)",
  }),
  reconciliationStrategy: Schema.optional(Schema.Literal("CONFIDENCE")).annotate({
    description: "Reconciliation strategy: CONFIDENCE only in G1–G3 (default: CONFIDENCE)",
  }),
  retention: Schema.optional(Schema.Struct({
    proposalDays: Schema.optional(Schema.Int).annotate({
      description: "Days to retain REJECTED proposals (default: 90, 0 = never delete)",
    }),
  })).annotate({
    description: "Retention policy for evolution data",
  }),
})
export type ConfigEvolution = Schema.Schema.Type<typeof ConfigEvolution>

export interface Status {
  readonly mode: "observe" | "assist" | "autonomous"
  readonly enabled: boolean
  readonly memory: { count: number; lastUpdate: number | null }
  readonly decisions: { count: number }
  readonly project: { detected: boolean; root: string; frameworks: string[] }
}

export interface Interface {
  // Registry accessors (ADR-007)
  memory(): EvolutionMemory.Interface
  decisions(): EvolutionDecisions.Interface
  project(): EvolutionProject.Interface

  // Utility methods
  status(): Effect.Effect<Status, EvolutionStorageError>
  getConfig(): Effect.Effect<ConfigEvolution>

  /** @deprecated Use memory() */
  getMemories(): Effect.Effect<EvolutionMemory.MemoryEntry[], EvolutionStorageError>
  /** @deprecated Use decisions() */
  getDecisions(): Effect.Effect<EvolutionDecisions.DecisionRecord[], EvolutionStorageError>
  /** @deprecated Use project() */
  getProjectContext(): Effect.Effect<EvolutionProject.ProjectProfile, EvolutionStorageError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Evolution") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const brain = yield* EvolutionBrain.Service

    const status = Effect.fn("Evolution.status")(function* () {
      const cfg = yield* config.get()
      const evCfg = cfg.evolution ?? {}
      const mode = evCfg.mode ?? "observe"
      const enabled = evCfg.enabled ?? false

      if (!enabled) {
        return {
          mode,
          enabled: false,
          memory: { count: 0, lastUpdate: null },
          decisions: { count: 0 },
          project: { detected: false, root: "", frameworks: [] },
        }
      }

      const [memorySummary, decisionsSummary, profile] = yield* Effect.all([
        brain.memory.summarize(),
        brain.decisions.summarize(),
        brain.project.profile().pipe(Effect.option),
      ])

      return {
        mode,
        enabled: true,
        memory: { count: memorySummary.count, lastUpdate: memorySummary.lastUpdate },
        decisions: { count: decisionsSummary.count },
        project: {
          detected: Option.isSome(profile),
          root: Option.isSome(profile) ? profile.value.root : "",
          frameworks: Option.isSome(profile) ? profile.value.frameworks : [],
        },
      }
    })

    const getConfig = Effect.fn("Evolution.getConfig")(function* () {
      const cfg = yield* config.get()
      return cfg.evolution ?? {}
    })

    const getProjectContext = Effect.fn("Evolution.getProjectContext")(function* () {
      return yield* brain.project.profile()
    })

    const getMemories = Effect.fn("Evolution.getMemories")(function* () {
      return yield* brain.memory.all()
    })

    const getDecisions = Effect.fn("Evolution.getDecisions")(function* () {
      return yield* brain.decisions.list()
    })

    return Service.of({
      memory: () => brain.memory,
      decisions: () => brain.decisions,
      project: () => brain.project,
      status,
      getConfig,
      getMemories: () => brain.memory.all(),
      getDecisions: () => brain.decisions.list(),
      getProjectContext: () => brain.project.profile(),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EvolutionBrain.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export const node = LayerNode.make(layer, [EvolutionBrain.node, Config.node])

export * as Evolution from "."
