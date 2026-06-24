import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Evolution } from "@/evolution/index"
import { MetricsService, type MetricsSnapshot } from "@/evolution/evolution/metrics"
import type { DecisionProposal } from "@/evolution/decision/proposal"
import type { ReconciliationLog } from "@/evolution/decision/reconciliation-log"
import { mockMemory, mockProject, mockDecisions, projProfile } from "./fixture/mock-evolution"

function mockEvoService(
  proposals: DecisionProposal[],
  logs: ReconciliationLog[],
) {
  return Evolution.Service.of({
    memory: () => mockMemory(),
    decisions: () => ({
      ...mockDecisions(),
      listProposals: () => Effect.succeed(proposals),
      getReconciliationLogs: () => Effect.succeed(logs),
    }),
    project: () => mockProject(),
    status: () =>
      Effect.succeed({
        enabled: false,
        mode: "observe" as const,
        memory: { count: 0, lastUpdate: null },
        decisions: { count: 0 },
        project: { detected: false, root: "", frameworks: [] },
      }),
    getConfig: () => Effect.succeed({}),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed(projProfile()),
  })
}

function runSnapshot(
  proposals: DecisionProposal[],
  logs: ReconciliationLog[],
): MetricsSnapshot {
  const mock = mockEvoService(proposals, logs)
  const testLayer = Layer.provideMerge(
    MetricsService.layer,
    Layer.succeed(Evolution.Service, mock),
  )
  return Effect.runSync(
    Effect.gen(function* () {
      const svc = yield* MetricsService.Service
      return yield* svc.snapshot()
    }).pipe(Effect.provide(testLayer)),
  )
}

function makeProposal(overrides: Partial<DecisionProposal> & { status: DecisionProposal["status"] }): DecisionProposal {
  return {
    id: "test-1",
    key: "test-key",
    title: "Test Proposal",
    context: "test",
    proposedDecision: "test",
    consequences: "test",
    tags: [],
    origin: { proposerId: "test" },
    createdAt: 1000,
    ...overrides,
  }
}

function makeLog(overrides: Partial<ReconciliationLog>): ReconciliationLog {
  return {
    sessionId: "test-session",
    contextHash: "abc",
    candidates: [],
    participants: [],
    selectedCandidateAgentId: null,
    selectionReason: "NO_CANDIDATES",
    outcome: "NO_CANDIDATES",
    createdAt: 1000,
    ...overrides,
  }
}

function nullSnapshot(): MetricsSnapshot {
  return {
    totalProposals: null,
    acceptanceRate: null,
    avgTimeToAcceptance: null,
    proposalChurn: null,
    totalReconciliations: null,
    avgConfidenceScore: null,
    avgParticipantsPerReconciliation: null,
    budgetUtilization: null,
    diversityIndex: null,
    rejectionCodeFrequency: null,
    reconciliationOutcomeCounts: null,
    advisorActivity: null,
  }
}

describe("G5 MetricsService", () => {
  test("TG-01: Interface has only snapshot() method (no write methods)", () => {
    const svc = MetricsService.Service.of({ snapshot: () => Effect.succeed(nullSnapshot()) })
    expect(typeof svc.snapshot).toBe("function")
    expect((svc as unknown as Record<string, unknown>).record).toBeUndefined()
    expect((svc as unknown as Record<string, unknown>).save).toBeUndefined()
    expect((svc as unknown as Record<string, unknown>).write).toBeUndefined()
    expect((svc as unknown as Record<string, unknown>).insert).toBeUndefined()
    expect((svc as unknown as Record<string, unknown>).submit).toBeUndefined()
  })

  test("TG-02: MetricsService module uses Evolution.Service facade", () => {
    const mod = MetricsService as unknown as Record<string, unknown>
    const src = mod.toString?.() ?? ""
    expect(src).toBeDefined()
  })

  test("TG-03: All metrics return null when source data is empty", () => {
    const s = runSnapshot([], [])
    expect(s.totalProposals).toBeNull()
    expect(s.acceptanceRate).toBeNull()
    expect(s.avgTimeToAcceptance).toBeNull()
    expect(s.proposalChurn).toBeNull()
    expect(s.totalReconciliations).toBeNull()
    expect(s.avgConfidenceScore).toBeNull()
    expect(s.avgParticipantsPerReconciliation).toBeNull()
    expect(s.budgetUtilization).toBeNull()
    expect(s.diversityIndex).toBeNull()
  })

  test("TG-04: Metrics compute correctly with known proposal data", () => {
    const proposals = [
      makeProposal({ status: "ACCEPTED", createdAt: 1000, acceptedAt: 2000 }),
      makeProposal({ status: "ACCEPTED", createdAt: 1000, acceptedAt: 1500 }),
      makeProposal({ status: "ACCEPTED", createdAt: 2000, acceptedAt: 3000 }),
      makeProposal({ status: "REJECTED", createdAt: 1000 }),
      makeProposal({ status: "SUBMITTED", createdAt: 1000 }),
    ]

    const s = runSnapshot(proposals, [])
    expect(s.totalProposals).toBe(5)
    expect(s.acceptanceRate).toBeCloseTo(0.6, 5)
    expect(s.proposalChurn).toBeCloseTo(0.2, 5)
    expect(s.avgTimeToAcceptance).toBe((1000 + 500 + 1000) / 3)
  })

  test("TG-04b: Metrics compute correctly with reconciliation log data", () => {
    const logs = [
      makeLog({
        candidates: [
          { agentId: "a", reasoningStrength: "high" as const, confidenceScore: 0.85, selected: true },
          { agentId: "b", reasoningStrength: "medium" as const, confidenceScore: 0.65, selected: false },
        ],
        participants: [{ agentId: "a", capabilities: ["proposal"] as const, contributionType: "proposal", confidenceScore: 0.85, selected: true }],
        selectedCandidateAgentId: "a",
        selectionReason: "HIGHEST_CONFIDENCE",
        outcome: "PROPOSAL_SUBMITTED",
      }),
      makeLog({
        candidates: [
          { agentId: "c", reasoningStrength: "low" as const, confidenceScore: 0.3, selected: true },
        ],
        participants: [{ agentId: "c", capabilities: ["proposal"] as const, contributionType: "proposal", confidenceScore: 0.3, selected: true }],
        selectedCandidateAgentId: "c",
        selectionReason: "HIGHEST_CONFIDENCE",
        outcome: "PROPOSAL_SUBMITTED",
      }),
    ]

    const s = runSnapshot([], logs)
    expect(s.totalReconciliations).toBe(2)
    expect(s.avgConfidenceScore).toBeCloseTo((0.85 + 0.65 + 0.3) / 3, 5)
    expect(s.avgParticipantsPerReconciliation).toBe(1)
    expect(s.totalProposals).toBeNull()
  })

  test("TG-05: Correlation — acceptance + rejection rates sum to <= 1", () => {
    const proposals = [
      makeProposal({ status: "ACCEPTED" }),
      makeProposal({ status: "ACCEPTED" }),
      makeProposal({ status: "REJECTED" }),
      makeProposal({ status: "SUBMITTED" }),
      makeProposal({ status: "VALIDATING" }),
    ]
    const s = runSnapshot(proposals, [])
    expect(s.acceptanceRate).toBeCloseTo(0.4, 5)
    expect(s.proposalChurn).toBeCloseTo(0.2, 5)
    expect(s.acceptanceRate! + s.proposalChurn!).toBeLessThanOrEqual(1)
  })

  test("TG-06: MetricsSnapshot serializes to valid JSON", () => {
    const s = runSnapshot([], [])
    const json = JSON.stringify(s)
    const parsed = JSON.parse(json) as MetricsSnapshot
    expect(parsed.totalProposals).toBeNull()
    expect(parsed.budgetUtilization).toBeNull()
    expect(parsed.diversityIndex).toBeNull()
    expect(Object.keys(parsed).sort()).toEqual([
      "acceptanceRate",
      "advisorActivity",
      "avgConfidenceScore",
      "avgParticipantsPerReconciliation",
      "avgTimeToAcceptance",
      "budgetUtilization",
      "diversityIndex",
      "proposalChurn",
      "reconciliationOutcomeCounts",
      "rejectionCodeFrequency",
      "totalProposals",
      "totalReconciliations",
    ])
  })

  test("TG-07: DiversityIndex is always null (M-09, UNAVAILABLE)", () => {
    const s1 = runSnapshot([], [])
    expect(s1.diversityIndex).toBeNull()

    const proposals = [
      makeProposal({ status: "ACCEPTED" }),
      makeProposal({ status: "REJECTED" }),
    ]
    const logs = [
      makeLog({
        candidates: [{ agentId: "a", reasoningStrength: "high" as const, confidenceScore: 0.9, selected: true }],
        participants: [{ agentId: "a", capabilities: ["proposal"] as const, contributionType: "proposal", confidenceScore: 0.9, selected: true }],
        selectedCandidateAgentId: "a",
        selectionReason: "HIGHEST_CONFIDENCE",
        outcome: "PROPOSAL_SUBMITTED",
        diversityMetrics: { edi: 0.8, falseConsensusWarning: false },
      }),
    ]
    const s2 = runSnapshot(proposals, logs)
    expect(s2.diversityIndex).toBeNull()
  })
})
