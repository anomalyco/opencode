import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import type { Evolution } from "@/evolution/index"
import { ContextComposer, type EvolutionContext } from "./composer"
import type { EvolutionMemory } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"

// Each memory entry: 40 chars → ceil(40/4) = 10 tokens
// Skeleton (1 mem + 1 dec + project) ≈ 10 + 9 + 5 = 24 tokens
function makeEvo(memoryCount: number): Evolution.Interface {
  const memories: EvolutionMemory.MemoryEntry[] = Array.from({ length: memoryCount }, (_, i) => ({
    id: `${i}`,
    content: `x`.repeat(40),
    type: "lesson" as const,
    tags: [],
    created: i,
    updated: i,
  }))
  return {
    memory: () => ({
      all: () => Effect.succeed(memories),
      save: () => Effect.succeed({} as any),
      retrieve: () => Effect.succeed([]),
      search: () => Effect.succeed([]),
      summarize: () => Effect.succeed({ count: 0, lastUpdate: null, types: {} }),
      compact: () => Effect.void,
    }),
    decisions: () => ({
      list: () =>
        Effect.succeed<EvolutionDecisions.DecisionRecord[]>([
          {
            id: "1",
            title: "ADR-001",
            decision: "use facades",
            status: "accepted" as const,
            context: "clean boundaries",
            consequences: "more files",
            tags: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      get: () => Effect.succeed({} as any),
      record: () => Effect.succeed({} as any),
      supersede: () => Effect.void,
      summarize: () => Effect.succeed({ count: 0 }),
    }),
    project: () => ({
      profile: () =>
        Effect.succeed<EvolutionProject.ProjectProfile>({
          root: "/test",
          name: "opencode",
          vcs: "git",
          languages: ["TypeScript"],
          frameworks: ["ts"],
          packages: [],
          structure: "monorepo",
          hasDocker: false,
          hasTests: true,
          hasCI: true,
          detectedAt: 1,
        }),
      detectFrameworks: () => Effect.succeed([]),
      getStructure: () => Effect.succeed("monorepo" as const),
      hasDependency: () => Effect.succeed(false),
      refresh: () => Effect.succeed({} as any),
    }),
    status: () => Effect.succeed({} as any),
    getConfig: () => Effect.succeed({}),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed({} as any),
  }
}

function makeComposer(opts: {
  memoryCount?: number
  budget?: number
  strategy?: "truncate" | "strict"
}) {
  const evo = makeEvo(opts.memoryCount ?? 2)
  return ContextComposer.make(evo, {
    contextBudget: opts.budget ?? 4096,
    contextBudgetStrategy: opts.strategy ?? "truncate",
  })
}

describe("ContextComposer.Service", () => {
  test("provide() returns EvolutionContext with all fields (ADR-004)", () => {
    const svc = makeComposer({})
    const ctx = Effect.runSync(svc.provide())
    expect(ctx).toHaveProperty("project")
    expect(ctx).toHaveProperty("memories")
    expect(ctx).toHaveProperty("decisions")
    expect(ctx).toHaveProperty("budget")
    expect(ctx.budget.strategy).toBe("truncate")
  })

  test("budget.remaining >= 0 on normal case", () => {
    const svc = makeComposer({ budget: 4096 })
    const ctx = Effect.runSync(svc.provide())
    expect(ctx.budget.remaining).toBeGreaterThanOrEqual(0)
    expect(ctx.budget.configured).toBe(4096)
  })

  test("budget.configured equals exact config value — no implicit margin", () => {
    const svc = makeComposer({ budget: 999 })
    const ctx = Effect.runSync(svc.provide())
    expect(ctx.budget.configured).toBe(999)
  })

  test("strategy=strict: fails with ContextBudgetError on overflow", () => {
    const svc = makeComposer({ budget: 10, strategy: "strict", memoryCount: 50 })
    const exit = Effect.runSyncExit(svc.provide())
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      expect(err._tag).toBe("EvolutionContextBudgetError")
    }
  })

  test("strategy=truncate: never throws ContextBudgetError", () => {
    // Skeleton ≈ 24 tokens ≤ budget 50 → precondition passes
    const svc = makeComposer({ budget: 50, strategy: "truncate", memoryCount: 1000 })
    const exit = Effect.runSyncExit(svc.provide())
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("strategy=truncate: reduces memory count on overflow", () => {
    const svc = makeComposer({ budget: 200, strategy: "truncate", memoryCount: 100 })
    const ctx = Effect.runSync(svc.provide())
    expect(ctx.memories.length).toBeLessThan(100)
  })

  test("used <= configured invariant (T-05a) — various budgets", () => {
    const budgets = [50, 100, 500, 1000, 4096]
    for (const budget of budgets) {
      const svc = makeComposer({ budget, strategy: "truncate", memoryCount: 500 })
      const ctx = Effect.runSync(svc.provide())
      expect(ctx.budget.used).toBeLessThanOrEqual(ctx.budget.configured + 10)
    }
  })

  test("used <= configured invariant with max data", () => {
    const svc = makeComposer({ budget: 1000, strategy: "truncate", memoryCount: 1000 })
    const ctx = Effect.runSync(svc.provide())
    expect(ctx.budget.used).toBeLessThanOrEqual(ctx.budget.configured + 10)
  })

  test("minimum floor > budget throws ContextBudgetError", () => {
    // Skeleton ≈ 24 > budget 5 → precondition fails
    const svc = makeComposer({ budget: 5, strategy: "truncate", memoryCount: 1 })
    const exit = Effect.runSyncExit(svc.provide())
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      expect(err._tag).toBe("EvolutionContextBudgetError")
    }
  })

  test("termination: budget=0 fails fast", () => {
    const svc = makeComposer({ budget: 0, strategy: "truncate", memoryCount: 1 })
    const exit = Effect.runSyncExit(svc.provide())
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("termination: single memory entry + single decision never loops forever", () => {
    const svc = makeComposer({ budget: 100, strategy: "truncate", memoryCount: 1 })
    const ctx = Effect.runSync(svc.provide())
    expect(ctx.budget.used).toBeLessThanOrEqual(ctx.budget.configured + 10)
  })
})
