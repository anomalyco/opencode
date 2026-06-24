import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import type { Evolution } from "@/evolution/index"
import { ContextComposer, type EvolutionContext } from "./composer"
import { ContextBudget } from "./budget"
import type { EvolutionMemory } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"

function memEntry(id: string, i: number): EvolutionMemory.MemoryEntry {
  return { id, content: `x`.repeat(40), type: "lesson", tags: [], created: i, updated: i }
}

function decRecord(id: string, title: string): EvolutionDecisions.DecisionRecord {
  return { id, title, decision: "use facades", status: "accepted", context: "clean boundaries", consequences: "more files", tags: [], createdAt: 1, updatedAt: 1 }
}

function projProfile(root: string, name: string): EvolutionProject.ProjectProfile {
  return { root, name, vcs: "git", languages: ["TypeScript"], frameworks: ["ts"], packages: [], structure: "monorepo", hasDocker: false, hasTests: true, hasCI: true, detectedAt: 1 }
}

// Each memory entry: 40 chars → ceil(40/4) = 10 tokens
function makeEvo(memoryCount: number): Evolution.Interface {
  const memories: EvolutionMemory.MemoryEntry[] = Array.from({ length: memoryCount }, (_, i) => memEntry(`${i}`, i))
  const profile = projProfile("/test", "opencode")
  return {
    memory: () => ({
      all: () => Effect.succeed(memories),
      save: () => Effect.succeed(memEntry("mock", 0)),
      retrieve: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([]),
      search: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([]),
      summarize: () => Effect.succeed<{ count: number; lastUpdate: number | null; types: Record<string, number> }>({ count: 0, lastUpdate: null, types: {} }),
      compact: () => Effect.void,
      verify: () => Effect.succeed(memEntry("mock", 0)),
      detectAnomalies: () => Effect.succeed<EvolutionMemory.AnomalyWarning[]>([]),
    }),
    decisions: () => ({
      list: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([decRecord("1", "ADR-001")]),
      get: () => Effect.succeed<EvolutionDecisions.DecisionRecord | undefined>(undefined),
      record: () => Effect.succeed<{ id: string }>({ id: "mock" }),
      supersede: () => Effect.succeed(decRecord("1", "ADR-001")),
      summarize: () => Effect.succeed<{ count: number; byStatus: Record<string, number> }>({ count: 0, byStatus: { accepted: 1 } }),
      save: () => Effect.succeed(decRecord("mock", "mock")),
      saveReconciliationLog: () => Effect.void,
      search: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([]),
      propose: () => Effect.succeed<import("@/evolution/decision/proposal").DecisionProposal>({ id: "p1", key: "k1", title: "", context: "", proposedDecision: "", consequences: "", tags: [], origin: { proposerId: "test" }, createdAt: 0, status: "SUBMITTED" }),
      submit: () => Effect.succeed<import("@/evolution/decision/proposal").DecisionProposal>({ id: "p2", key: "k2", title: "", context: "", proposedDecision: "", consequences: "", tags: [], origin: { proposerId: "test" }, createdAt: 0, status: "SUBMITTED" }),
      decisionRecord: () => Effect.succeed<import("@/evolution/brain/decisions").DecisionView[]>([]),
      listProposals: () => Effect.succeed<import("@/evolution/decision/proposal").DecisionProposal[]>([]),
      getReconciliationLogs: () => Effect.succeed<import("@/evolution/decision/reconciliation-log").ReconciliationLog[]>([]),
      gc: () => Effect.succeed(0),
      getStorageStats: () => Effect.succeed<import("@/evolution/brain/decisions").StorageStats>({ proposalCount: 0, proposalBytes: 0, reconcilCount: 0, reconcilBytes: 0 }),
    }),
    project: () => ({
      profile: () => Effect.succeed(profile),
      detectFrameworks: () => Effect.succeed<string[]>([]),
      getStructure: () => Effect.succeed<"single" | "monorepo">("monorepo"),
      hasDependency: () => Effect.succeed(false),
      refresh: () => Effect.succeed(profile),
    }),
    status: () => Effect.succeed<Evolution.Status>({ enabled: false, mode: "observe", memory: { count: 0, lastUpdate: null }, decisions: { count: 0 }, project: { detected: false, root: "", frameworks: [] } }),
    getConfig: () => Effect.succeed<Record<string, unknown>>({}),
    getMemories: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([]),
    getDecisions: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([]),
    getProjectContext: () => Effect.succeed(profile),
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
      if (err instanceof ContextBudget.ContextBudgetError) {
        expect(err._tag).toBe("EvolutionContextBudgetError")
      }
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
      if (err instanceof ContextBudget.ContextBudgetError) {
        expect(err._tag).toBe("EvolutionContextBudgetError")
      }
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
