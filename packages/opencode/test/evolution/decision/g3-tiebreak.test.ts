import { describe, expect, test } from "bun:test"
import { ConfidenceReconciliationStrategy } from "@/evolution/decision/strategies/confidence"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"

describe("TG-TIEBREAK — deterministic tie-breaking: confidenceScore → agentId lexical", () => {
  test("same confidence → earlier lexical agentId wins", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "b-agent", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 100 },
      { agentId: "a-agent", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 200 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })

    expect(result.selectedCandidateAgentId).toBe("a-agent")
  })

  test("tie-break is deterministic (same input, same output)", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "z", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 50 },
      { agentId: "m", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 100 },
      { agentId: "a", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 150 },
    ]

    const run1 = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })
    const run2 = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })

    expect(run1.selectedCandidateAgentId).toBe("a")
    expect(run2.selectedCandidateAgentId).toBe("a")
    expect(run1.selectedCandidateAgentId).toBe(run2.selectedCandidateAgentId)
  })

  test("higher confidence wins regardless of agentId", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
      { agentId: "z", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 1 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, { minCandidateConfidence: 0.3 })

    expect(result.selectedCandidateAgentId).toBe("z")
  })
})
