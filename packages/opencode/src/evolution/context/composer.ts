import { Effect } from "effect"
import type { ConfigEvolution } from "@/evolution/index"
import type { Evolution } from "@/evolution/index"
import { ContextBudget, type ContextBudgetError } from "./budget"
import { ContextRetriever } from "./retriever"

// ADR-004 contract — typed output boundary
export interface EvolutionContext {
  readonly project: {
    readonly name: string
    readonly frameworks: string[]
    readonly structure: string
  }
  readonly memories: ReadonlyArray<{
    readonly content: string
    readonly type: string
  }>
  readonly decisions: ReadonlyArray<{
    readonly title: string
    readonly decision: string
    readonly status: string
  }>
  readonly budget: {
    readonly configured: number
    readonly used: number
    readonly remaining: number
    readonly strategy: "truncate" | "strict"
  }
}

// TRUNCATION PRIORITY (HYPOTHESIS — DF-09)
// Current order: Memory > Decisions > Project (never truncated)
// Evidence: None — project context preserved first as largest signal
// Verification target: Phase 2 Verification
function truncateCount(oldCount: number, ratio: number): number {
  // Guarantees: newCount < oldCount whenever truncation is needed
  const proportional = Math.floor(oldCount * ratio * 0.8)
  return Math.max(1, Math.min(oldCount - 1, proportional))
}

export interface Interface {
  readonly provide: () => Effect.Effect<EvolutionContext, ContextBudgetError>
}

export const make = (
  evolution: Evolution.Interface,
  config: ConfigEvolution,
): Interface => {
  const budget = ContextBudget.make(config)
  const retriever = ContextRetriever.make(evolution)
  const strategy = config.contextBudgetStrategy ?? "truncate"

  return {
    provide: () =>
      Effect.gen(function* () {
        const raw = yield* retriever.retrieve()
        const usage = retriever.estimate(raw)
        const limit = budget.budget()
        const total = budget.total(usage)

        if (total <= limit) {
          return composeCtx(raw, total, limit, strategy)
        }

        if (strategy === "strict") {
          yield* budget.enforce(usage)
        }

        // PRE-CONDITION: minimum context floor must fit within budget
        // If even skeleton data exceeds budget, truncation cannot save us
        const skeleton = retriever.estimate({
          memory: raw.memory.slice(0, 1),
          decisions: raw.decisions.slice(0, 1),
          project: raw.project,
        })
        const skeletonTokens = skeleton.memory + skeleton.decisions + skeleton.project
        if (skeletonTokens > limit) {
          return yield* new ContextBudget.ContextBudgetError({
            message: `Budget ${limit} is insufficient for minimal context (${skeletonTokens}). ` +
              `Increase contextBudget in config.`,
          })
        }

        // GUARANTEED: minimumFloor <= budget → loop will terminate
        // monotonic shrink ensures newCount < oldCount each iteration
        let mem = raw.memory
        let decs = raw.decisions
        let used = total

        while (used > limit) {
          const ratio = limit / used
          mem = mem.slice(0, truncateCount(mem.length, ratio))
          decs = decs.slice(0, truncateCount(decs.length, ratio))

          const u = retriever.estimate({ memory: mem, decisions: decs, project: raw.project })
          used = u.memory + u.decisions + u.project
        }

        return {
          project: {
            name: raw.project.name,
            frameworks: raw.project.frameworks,
            structure: raw.project.structure,
          },
          memories: mem.map(m => ({ content: m.content, type: m.type })),
          decisions: decs.map(d => ({ title: d.title, decision: d.decision, status: d.status })),
          budget: {
            configured: limit,
            used,
            remaining: limit - used,
            strategy,
          },
        }
      }),
  }
}

function composeCtx(
  raw: Awaited<ReturnType<ContextRetriever.Interface["retrieve"]>>,
  total: number,
  limit: number,
  strategy: "truncate" | "strict",
): EvolutionContext {
  return {
    project: {
      name: raw.project.name,
      frameworks: raw.project.frameworks,
      structure: raw.project.structure,
    },
    memories: raw.memory.map(m => ({ content: m.content, type: m.type })),
    decisions: raw.decisions.map(d => ({ title: d.title, decision: d.decision, status: d.status })),
    budget: { configured: limit, used: total, remaining: limit - total, strategy },
  }
}

export * as ContextComposer from "./composer"
