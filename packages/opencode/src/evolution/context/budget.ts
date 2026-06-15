import { Effect, Schema } from "effect"
import type { ConfigEvolution } from "@/evolution/index"

export class ContextBudgetError extends Schema.TaggedErrorClass<ContextBudgetError>()("EvolutionContextBudgetError", {
  message: Schema.String,
}) {}

export interface DomainUsage {
  readonly memory: number
  readonly decisions: number
  readonly project: number
}

export interface Interface {
  readonly budget: () => number
  readonly total: (usage: DomainUsage) => number
  readonly enforce: (usage: DomainUsage) => Effect.Effect<void, ContextBudgetError>
}

export const make = (config: ConfigEvolution): Interface => ({
  budget: () => config.contextBudget ?? 4096,

  total: (usage) => usage.memory + usage.decisions + usage.project,

  enforce: (usage) => {
    const limit = config.contextBudget ?? 4096
    const used = usage.memory + usage.decisions + usage.project

    if (used > limit) {
      return Effect.fail(
        new ContextBudgetError({
          message: `Context budget exceeded: ${used} tokens used, ${limit} configured. ` +
            `Breakdown — memory: ${usage.memory}, decisions: ${usage.decisions}, project: ${usage.project}. ` +
            `Adjust contextBudget in config or use contextBudgetStrategy: "truncate".`,
        }),
      )
    }
    return Effect.void
  },
})

export * as ContextBudget from "./budget"
