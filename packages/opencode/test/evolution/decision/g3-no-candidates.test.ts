import { describe, expect, test } from "bun:test"
import { ConfidenceReconciliationStrategy } from "@/evolution/decision/strategies/confidence"

describe("TG-NO-CANDIDATES — zero candidates is distinct from BELOW_THRESHOLD", () => {
  test("zero candidates → NO_CANDIDATES outcome (system error)", () => {
    const result = ConfidenceReconciliationStrategy.reconcile([], { minCandidateConfidence: 0.3 })

    expect(result.outcome).toBe("NO_CANDIDATES")
    expect(result.selectedCandidate).toBeNull()
    expect(result.selectedCandidateAgentId).toBeNull()
    expect(result.selectionReason).toBe("NO_CANDIDATES")
    expect(result.candidates).toEqual([])
  })

  test("NO_CANDIDATES is NOT BELOW_THRESHOLD", () => {
    const noCandidates = ConfidenceReconciliationStrategy.reconcile([], { minCandidateConfidence: 0.3 })
    const belowThreshold = ConfidenceReconciliationStrategy.reconcile(
      [{ agentId: "a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 }],
      { minCandidateConfidence: 0.3 },
    )

    expect(noCandidates.outcome).toBe("NO_CANDIDATES")
    expect(belowThreshold.outcome).toBe("BELOW_THRESHOLD")
    expect(noCandidates.outcome).not.toBe(belowThreshold.outcome)
  })
})
