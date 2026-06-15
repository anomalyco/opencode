import { Effect } from "effect"
import type { Evolution } from "@/evolution/index"
import type { EvolutionMemory } from "@/evolution/brain/memory"
import type { EvolutionDecisions } from "@/evolution/brain/decisions"
import type { EvolutionProject } from "@/evolution/brain/project"
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

export const make = (evolution: Evolution.Interface): Interface => ({
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

      return { memory: memories, decisions, project }
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
