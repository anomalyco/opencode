import { Effect } from "effect"
import type { ConfigEvolution, Evolution } from "@/evolution/index"
import type { EvolutionMemory } from "../brain/memory"
import { effectiveConfidence, isStale, DEFAULT_STALE_THRESHOLD_DAYS } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"
import { EvolutionStorageError } from "@/evolution/error"
import { TokenEstimator } from "./token-estimator"
import type { DomainUsage } from "./budget"

export interface Interface {
  readonly retrieve: () => Effect.Effect<{
    memory: EvolutionMemory.MemoryEntry[]
    decisions: EvolutionDecisions.DecisionRecord[]
    project: EvolutionProject.ProjectProfile
  }, EvolutionStorageError>

  readonly estimate: (ctx: {
    memory: EvolutionMemory.MemoryEntry[]
    decisions: EvolutionDecisions.DecisionRecord[]
    project: EvolutionProject.ProjectProfile
  }) => DomainUsage
}

export const make = (evolution: Evolution.Interface, config: ConfigEvolution): Interface => ({
  retrieve: () =>
    Effect.gen(function* () {
      const memSvc = evolution.memory()
      const decSvc = evolution.decisions()
      const prjSvc = evolution.project()

      const [memories, decisions, project] = yield* Effect.all([
        memSvc.all(),
        decSvc.list(),
        prjSvc.profile(),
      ])

      const staleDays = config.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS
      const active = memories.filter(m => staleDays === 0 || !isStale(m, Date.now(), staleDays))
      const sorted = [...active].sort((a, b) => effectiveConfidence(b) - effectiveConfidence(a))

      return { memory: sorted, decisions, project }
    }),

  estimate: (ctx) => ({
    memory: ctx.memory.reduce(
      (acc, m) => acc + TokenEstimator.estimateTokens(m.content),
      0,
    ),
    decisions: ctx.decisions.reduce(
      (acc, d) => acc + TokenEstimator.estimateTokens(d.title + d.decision + d.context),
      0,
    ),
    project: TokenEstimator.estimateTokens(
      ctx.project.name + ctx.project.structure + ctx.project.frameworks.join(" "),
    ),
  }),
})

export * as ContextRetriever from "./retriever"
