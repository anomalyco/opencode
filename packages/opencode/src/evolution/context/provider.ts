import { Effect, Option } from "effect"
import { Evolution } from "@/evolution/index"
import type { ConfigEvolution } from "@/evolution/index"
import { ContextComposer, type EvolutionContext } from "./composer"

// SystemContextProvider — internal runtime provider
// AR-04 (ADR-008): No public context() accessor on Evolution.Interface.
// C-VERIFY-02: Only calls composer.provide(), formats output, graceful degradation.
// C-VERIFY-03: No brain/* imports.

export namespace SystemContextProvider {
  export interface Interface {
    readonly provide: () => Effect.Effect<string, never>
  }
}

export function formatEvolutionContext(ctx: EvolutionContext): string {
  const lines: string[] = []

  lines.push("## Evolution: Project Context")
  lines.push(
    `Name: ${ctx.project.name} | Structure: ${ctx.project.structure} | ` +
    `Frameworks: ${ctx.project.frameworks.join(", ") || "none"}`,
  )

  if (ctx.memories.length > 0) {
    lines.push("\n## Evolution: Learned Patterns")
    for (const m of ctx.memories) {
      lines.push(`- [${m.type}] ${m.content}`)
    }
  }

  if (ctx.decisions.length > 0) {
    lines.push("\n## Evolution: Active Decisions")
    for (const d of ctx.decisions) {
      lines.push(`- ${d.title} (${d.status}): ${d.decision}`)
    }
  }

  lines.push(
    `\n<!-- Evolution budget: ${ctx.budget.used}/${ctx.budget.configured} tokens ` +
    `(${ctx.budget.strategy}) -->`,
  )

  return lines.join("\n")
}

export const make = (
  evolution: Evolution.Interface,
  config: ConfigEvolution,
): SystemContextProvider.Interface => {
  const composer = ContextComposer.make(evolution, config)

  return {
    provide: () =>
      composer.provide().pipe(
        Effect.map(formatEvolutionContext),
        Effect.catch(() => {
          console.warn("[EF-AI] SystemContextProvider failed — returning empty context")
          return Effect.succeed("")
        }),
      ),
  }
}

export const fromConfig = (
  config: ConfigEvolution,
): SystemContextProvider.Interface => ({
  provide: () =>
    Effect.gen(function* () {
      const option = yield* Effect.serviceOption(Evolution.Service)

      if (Option.isNone(option)) {
        yield* Effect.logWarning("[EF-AI] Evolution.Service unavailable — returning empty context")
        return ""
      }

      return yield* make(option.value, config).provide()
    }),
})

export * as SystemContextProvider from "./provider"
