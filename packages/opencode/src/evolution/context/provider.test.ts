import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Evolution } from "@/evolution/index"
import { SystemContextProvider, formatEvolutionContext } from "./provider"
import type { EvolutionContext } from "./composer"
import type { EvolutionMemory } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"
import { EvolutionStorageError } from "@/evolution/error"

function memEntry(id: string, i: number): EvolutionMemory.MemoryEntry {
  return { id, content: `pattern ${i}`, type: "lesson", tags: [], created: i, updated: i }
}

function decRecord(id: string, title: string): EvolutionDecisions.DecisionRecord {
  return { id, title, decision: "flat budget", status: "accepted", context: "phase 2", consequences: "simpler", tags: [], createdAt: 1, updatedAt: 1 }
}

function projProfile(): EvolutionProject.ProjectProfile {
  return { root: "/", name: "opencode", vcs: "git", languages: ["ts"], frameworks: ["bun"], packages: [], structure: "monorepo", hasDocker: false, hasTests: true, hasCI: true, detectedAt: 1 }
}

function makeEvolution(memoryCount = 2): Evolution.Interface {
  const memories: EvolutionMemory.MemoryEntry[] = Array.from({ length: memoryCount }, (_, i) => memEntry(`${i}`, i))
  const profile = projProfile()
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
      list: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([decRecord("1", "ADR-007")]),
      get: () => Effect.succeed<EvolutionDecisions.DecisionRecord | undefined>(undefined),
      record: () => Effect.succeed<{ id: string }>({ id: "mock" }),
      supersede: () => Effect.succeed(decRecord("1", "ADR-007")),
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

describe("SystemContextProvider", () => {
  test("provide() returns non-empty string on happy path", () => {
    const svc = SystemContextProvider.make(makeEvolution(), { contextBudget: 4096 })
    const result = Effect.runSync(svc.provide())
    expect(result).toBeTypeOf("string")
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain("Evolution: Project Context")
  })

  test("provide() returns empty string on storage failure (graceful degradation)", () => {
    const broken: Evolution.Interface = {
      ...makeEvolution(),
      memory: () => ({
        ...makeEvolution().memory(),
        all: () => Effect.fail(new EvolutionStorageError({ message: "disk full", operation: "read" })),
      }),
    }
    const svc = SystemContextProvider.make(broken, { contextBudget: 4096 })
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
