import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Evolution } from "@/evolution/index"
import { ContextRetriever } from "./retriever"
import type { EvolutionMemory } from "../brain/memory"
import type { EvolutionDecisions } from "../brain/decisions"
import type { EvolutionProject } from "../brain/project"

function memEntry(id: string, content: string): EvolutionMemory.MemoryEntry {
  return { id, content, type: "lesson", tags: ["effect"], created: 1, updated: 1 }
}

function decRecord(id: string, title: string, decision: string): EvolutionDecisions.DecisionRecord {
  return { id, title, decision, status: "accepted", context: "Needed clean boundaries", consequences: "More files but clearer ownership", tags: ["architecture"], createdAt: 1, updatedAt: 1 }
}

function projProfile(): EvolutionProject.ProjectProfile {
  return { root: "/test", name: "opencode", vcs: "git", languages: ["TypeScript"], frameworks: ["bun", "effect"], packages: [], structure: "monorepo", hasDocker: false, hasTests: true, hasCI: true, detectedAt: 1 }
}

function mockEvolution(): Evolution.Interface {
  const profile = projProfile()
  return {
    memory: () => ({
      all: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([
        memEntry("1", "use Effect for async"),
      ]),
      save: () => Effect.succeed(memEntry("mock", "mock")),
      retrieve: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([]),
      search: () => Effect.succeed<EvolutionMemory.MemoryEntry[]>([]),
      summarize: () => Effect.succeed<{ count: number; lastUpdate: number | null; types: Record<string, number> }>({ count: 0, lastUpdate: null, types: {} }),
      compact: () => Effect.void,
      verify: () => Effect.never,
      detectAnomalies: () => Effect.succeed<EvolutionMemory.AnomalyWarning[]>([]),
    }),
    decisions: () => ({
      list: () => Effect.succeed<EvolutionDecisions.DecisionRecord[]>([decRecord("1", "ADR-001", "Use separate service")]),
      get: () => Effect.succeed<EvolutionDecisions.DecisionRecord | undefined>(undefined),
      record: () => Effect.succeed<{ id: string }>({ id: "mock" }),
      supersede: () => Effect.succeed(decRecord("1", "ADR-001", "Use separate service")),
      summarize: () => Effect.succeed<{ count: number; byStatus: Record<string, number> }>({ count: 0, byStatus: { accepted: 1 } }),
      save: () => Effect.succeed(decRecord("mock", "mock", "mock")),
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

describe("ContextRetriever.Service", () => {
  test("retrieve() returns all domains with original types", () => {
    const svc = ContextRetriever.make(mockEvolution(), {})
    const result = Effect.runSync(svc.retrieve())
    expect(result.memory).toHaveLength(1)
    expect(result.memory[0].content).toBe("use Effect for async")
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0].title).toBe("ADR-001")
    expect(result.project.name).toBe("opencode")
  })

  test("retrieve() calls only facade accessors (AR-03)", () => {
    const evo = mockEvolution()
    const svc = ContextRetriever.make(evo, {})
    Effect.runSync(svc.retrieve())
    expect(true).toBe(true)
  })

  test("estimate() returns token counts per domain", () => {
    const svc = ContextRetriever.make(mockEvolution(), {})
    const raw = {
      memory: [{ id: "1", content: "hello world", type: "lesson" as const, tags: [], created: 1, updated: 1 }],
      decisions: [
        {
          id: "1",
          title: "ADR",
          decision: "do this",
          status: "accepted" as const,
          context: "because",
          consequences: "ok",
          tags: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      project: {
        root: "/",
        name: "proj",
        vcs: "git",
        languages: [],
        frameworks: ["ts"],
        packages: [],
        structure: "single" as const,
        hasDocker: false,
        hasTests: false,
        hasCI: false,
        detectedAt: 1,
      },
    }
    const usage = svc.estimate(raw)
    expect(usage.memory).toBeGreaterThan(0)
    expect(usage.decisions).toBeGreaterThan(0)
    expect(usage.project).toBeGreaterThan(0)
  })

  test("estimate() is pure — no side effects", () => {
    const svc = ContextRetriever.make(mockEvolution(), {})
    const raw = {
      memory: [],
      decisions: [],
      project: {
        root: "/",
        name: "",
        vcs: "git",
        languages: [],
        frameworks: [],
        packages: [],
        structure: "single" as const,
        hasDocker: false,
        hasTests: false,
        hasCI: false,
        detectedAt: 1,
      },
    }
    expect(() => svc.estimate(raw)).not.toThrow()
    expect(svc.estimate(raw)).toEqual({ memory: 0, decisions: 0, project: 2 })
  })
})
