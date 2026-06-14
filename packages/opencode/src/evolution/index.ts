import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema, Option } from "effect"
import { Config } from "@/config/config"
import { EvolutionBrain } from "./brain"
import { EvolutionProject } from "./brain/project"
import { EvolutionMemory } from "./brain/memory"
import { EvolutionDecisions } from "./brain/decisions"
import { EvolutionStorageError } from "./error"

export const ConfigEvolution = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable Evolution Layer (default: false)",
  }),
  mode: Schema.optional(Schema.Literals(["observe", "assist", "autonomous"])).annotate({
    description: "Evolution mode: observe (read-only), assist (suggestions), autonomous (auto-execute)",
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
  readonly status: () => Effect.Effect<Status, EvolutionStorageError>
  readonly getConfig: () => Effect.Effect<ConfigEvolution>
  readonly getProjectContext: () => Effect.Effect<EvolutionProject.ProjectProfile, EvolutionStorageError>
  readonly getMemories: () => Effect.Effect<EvolutionMemory.MemoryEntry[], EvolutionStorageError>
  readonly getDecisions: () => Effect.Effect<EvolutionDecisions.DecisionRecord[], EvolutionStorageError>
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

    return Service.of({ status, getConfig, getProjectContext, getMemories, getDecisions })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EvolutionBrain.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export const node = LayerNode.make(layer, [EvolutionBrain.node, Config.node])

export * as Evolution from "."
