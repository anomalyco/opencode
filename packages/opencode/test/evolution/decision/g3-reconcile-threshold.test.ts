import { describe, expect, test } from "bun:test"
import { ConfidenceReconciliationStrategy } from "@/evolution/decision/strategies/confidence"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"

describe("TG-RECONCILE-THRESHOLD — all candidates below threshold", () => {
  const LOW_THRESHOLD = 0.3

  test("all candidates below threshold → BELOW_THRESHOLD outcome", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "low-a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
      { agentId: "low-b", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 1 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: LOW_THRESHOLD })

    expect(result.outcome).toBe("BELOW_THRESHOLD")
    expect(result.selectedCandidate).toBeNull()
    expect(result.selectedCandidateAgentId).toBeNull()
  })

  test("BELOW_THRESHOLD is a valid outcome (not an error)", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "low", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: LOW_THRESHOLD })

    expect(result.outcome).toBe("BELOW_THRESHOLD")
    expect(result.selectionReason).toBe("BELOW_THRESHOLD")
  })

  test("all candidates rejected with rejectionReason", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: LOW_THRESHOLD })

    for (const c of result.candidates) {
      expect(c.rejectionReason).toBeDefined()
      expect(c.rejectionReason).toContain("confidence")
    }
  })

  test("medium confidence below threshold is rejected", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "a", reasoningStrength: "medium", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.6 })

    expect(result.outcome).toBe("BELOW_THRESHOLD")
  })
})
