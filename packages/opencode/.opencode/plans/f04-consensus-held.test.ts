import { describe, expect, test } from "bun:test"
import { ConfidenceReconciliationStrategy } from "../../src/evolution/decision/strategies/confidence"
import type { ProposalCandidate } from "../../src/evolution/decision/proposal-candidate"
import type { AdvisorContext } from "../../src/evolution/decision/reconciliation-log"

function makeCandidate(overrides: Partial<ProposalCandidate> & { agentId: string }): ProposalCandidate {
  return {
    reasoningStrength: "medium",
    rationale: "test rationale",
    proposedAction: "Accept proposal",
    tags: ["test"],
    agentId: overrides.agentId,
    producedAt: Date.now(),
    ...overrides,
  }
}

const vetoContext: AdvisorContext = {
  riskAssessment: {
    overallSeverity: "critical",
    recommendationCategory: "REJECT",
    rationale: "Critical architectural risk",
    risks: [{ description: "Test", severity: "critical", category: "architectural" }],
  },
}

const normalContext: AdvisorContext = {
  riskAssessment: {
    overallSeverity: "low",
    recommendationCategory: "APPROVE",
    rationale: "Safe",
    risks: [],
  },
}

describe("F-04 — Consensus + HELD", () => {
  test("HELD_FOR_REVIEW when riskAgent vetoes (critical + REJECT)", () => {
    const candidates = [makeCandidate({ agentId: "a" })]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 }, vetoContext)
    expect(result.outcome).toBe("HELD_FOR_REVIEW")
    expect(result.selectedCandidate).toBeNull()
  })

  test("normal PROPOSAL_SUBMITTED when no veto", () => {
    const candidates = [makeCandidate({ agentId: "a" })]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 }, normalContext)
    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
    expect(result.selectedCandidateAgentId).toBe("a")
  })

  test("single candidate auto-selects", () => {
    const candidates = [makeCandidate({ agentId: "a" })]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })
    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
    expect(result.selectedCandidateAgentId).toBe("a")
  })

  test("NO_CANDIDATES when empty", () => {
    const result = ConfidenceReconciliationStrategy.reconcile([], { minCandidateConfidence: 0.3 })
    expect(result.outcome).toBe("NO_CANDIDATES")
  })

  test("BELOW_THRESHOLD when confidence too low", () => {
    const candidates = [makeCandidate({ agentId: "a", reasoningStrength: "low" })]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.9 })
    expect(result.outcome).toBe("BELOW_THRESHOLD")
  })

  test("HELD veto takes priority over single-candidate auto-select", () => {
    const candidates = [makeCandidate({ agentId: "a", reasoningStrength: "high" })]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 }, vetoContext)
    expect(result.outcome).toBe("HELD_FOR_REVIEW")
    // Even with high confidence, veto blocks
    expect(result.selectedCandidate).toBeNull()
  })

  test("consensus selects from agreeing group when multiple candidates agree", () => {
    const candidates = [
      makeCandidate({ agentId: "a", proposedAction: "Accept architecture", reasoningStrength: "medium" }),
      makeCandidate({ agentId: "b", proposedAction: "Accept architecture", reasoningStrength: "high" }),
      makeCandidate({ agentId: "c", proposedAction: "Reject proposal", reasoningStrength: "low" }),
    ]
    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })
    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
    // Two agents agree on "Accept architecture" → consensus selects highest confidence from that group
    expect(result.selectedCandidateAgentId).toBe("b") // "b" has high confidence
  })
})
