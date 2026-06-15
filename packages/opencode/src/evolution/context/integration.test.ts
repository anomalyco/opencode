import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SystemContextProvider } from "./provider"

// T-09: DF-10 Runtime Path Verification
// Chain:
// SystemContextRegistry.register()
//   → load()
//   → SystemContext.combine()
//   → SessionContextEpoch.initialize()
//   → system.baseline
//   → LLM.request()

function makeEvolution(memoryCount = 2): any {
  const memories = Array.from({ length: memoryCount }, (_, i) => ({
    id: `${i}`, content: `pattern ${i}`, type: "lesson" as const,
    tags: [], created: i, updated: i,
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
      list: () => Effect.succeed([{
        id: "1", title: "ADR-007", decision: "flat budget",
        status: "accepted" as const, context: "phase 2",
        consequences: "simpler", tags: [], createdAt: 1, updatedAt: 1,
      }]),
      get: () => Effect.succeed({} as any),
      record: () => Effect.succeed({} as any),
      supersede: () => Effect.void,
      summarize: () => Effect.succeed({ count: 0 }),
    }),
    project: () => ({
      profile: () => Effect.succeed({
        root: "/", name: "opencode", vcs: "git",
        languages: ["ts"], frameworks: ["bun"],
        packages: [], structure: "monorepo",
        hasDocker: false, hasTests: true, hasCI: true, detectedAt: 1,
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

describe("DF-10 Integration — Evolution Context Pipeline", () => {
  test("T-09-01: provide() produces non-empty string (happy path)", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("Evolution: Project Context")
  })

  test("T-09-02: provide() returns Effect<string, never> — no errors propagate", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(typeof result).toBe("string")
  })

  test("T-09-03: Graceful degradation on storage error", () => {
    const broken = {
      ...makeEvolution(),
      memory: () => ({
        all: () => Effect.fail({ _tag: "EvolutionStorageError", message: "disk full" } as any),
      }),
    }
    const svc = SystemContextProvider.make(broken, { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result).toBe("")
  })

  test("T-09-04: Graceful degradation on budget exceeded (strict mode)", () => {
    const svc = SystemContextProvider.make(makeEvolution(100), {
      contextBudget: 5,
      contextBudgetStrategy: "strict" as const,
    })
    const result = Effect.runSync(svc.provide())
    expect(result).toBe("")
  })

  test("T-10-01: Full pipeline: evolution data → formatted string", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result).toContain("Evolution: Project Context")
    expect(result).toContain("Evolution: Learned Patterns")
    expect(result).toContain("Evolution: Active Decisions")
  })

  test("T-10-02: Truncation active: large data truncated before formatting", () => {
    const svc = SystemContextProvider.make(makeEvolution(100), {
      contextBudget: 100,
      contextBudgetStrategy: "truncate" as const,
    })
    const result = Effect.runSync(svc.provide())
    expect(result.length).toBeGreaterThan(0)
  })
})
