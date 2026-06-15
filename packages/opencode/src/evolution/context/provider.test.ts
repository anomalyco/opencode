import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Evolution } from "@/evolution/index"
import { SystemContextProvider, formatEvolutionContext } from "./provider"
import type { EvolutionContext } from "./composer"

function makeEvolution(memoryCount = 2): Evolution.Interface {
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

describe("SystemContextProvider", () => {
  test("provide() returns non-empty string on happy path", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result).toBeTypeOf("string")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("Evolution: Project Context")
  })

  test("provide() returns empty string on storage failure (graceful degradation)", () => {
    const broken = {
      ...makeEvolution(),
      memory: () => ({
        all: () => Effect.fail({ _tag: "EvolutionStorageError", message: "disk full" } as any),
      }),
    }
    const svc = SystemContextProvider.make(broken as any, { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result).toBe("")
  })

  test("provide() returns empty string on budget exceeded strict mode", () => {
    const svc = SystemContextProvider.make(makeEvolution(100), {
      contextBudget: 5,
      contextBudgetStrategy: "strict" as const,
    })
    const result = Effect.runSync(svc.provide())
    expect(result).toBe("")
  })

  test("provide() returns Effect<string, never> — no errors propagate", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(typeof result).toBe("string")
  })
})

describe("formatEvolutionContext", () => {
  const sampleCtx: EvolutionContext = {
    project: { name: "opencode", frameworks: ["bun", "effect"], structure: "monorepo" },
    memories: [{ content: "use Effect for async", type: "lesson" }],
    decisions: [{ title: "ADR-007", decision: "flat budget", status: "accepted" }],
    budget: { configured: 4096, used: 500, remaining: 3596, strategy: "truncate" },
  }

  test("includes project section", () => {
    const out = formatEvolutionContext(sampleCtx)
    expect(out).toContain("Evolution: Project Context")
    expect(out).toContain("opencode")
  })

  test("includes memories section", () => {
    const out = formatEvolutionContext(sampleCtx)
    expect(out).toContain("Evolution: Learned Patterns")
    expect(out).toContain("[lesson]")
  })

  test("includes decisions section", () => {
    const out = formatEvolutionContext(sampleCtx)
    expect(out).toContain("Evolution: Active Decisions")
    expect(out).toContain("ADR-007")
  })

  test("includes budget comment", () => {
    const out = formatEvolutionContext(sampleCtx)
    expect(out).toContain("500/4096 tokens")
  })

  test("omits memories section when empty", () => {
    const ctx = { ...sampleCtx, memories: [] }
    expect(formatEvolutionContext(ctx)).not.toContain("Learned Patterns")
  })

  test("omits decisions section when empty", () => {
    const ctx = { ...sampleCtx, decisions: [] }
    expect(formatEvolutionContext(ctx)).not.toContain("Active Decisions")
  })
})
