import { describe, expect, test } from "bun:test"
import { ConfidenceReconciliationStrategy } from "@/evolution/decision/strategies/confidence"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"

describe("TG-RECONCILE-HIGHEST — highest confidence wins", () => {
  const config = { minCandidateConfidence: 0.3 }

  test("selects candidate with highest confidence", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "low-agent", reasoningStrength: "low", rationale: "low", proposedAction: "low", tags: [], producedAt: 1 },
      { agentId: "high-agent", reasoningStrength: "high", rationale: "high", proposedAction: "high", tags: [], producedAt: 2 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, config)

    expect(result.outcome).toBe("PROPOSAL_SUBMITTED")
    expect(result.selectedCandidateAgentId).toBe("high-agent")
    expect(result.selectedCandidate!.reasoningStrength).toBe("high")
    expect(result.selectedCandidate!.agentId).toBe("high-agent")
  })

  test("reports HIGHEST_CONFIDENCE as selection reason", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
      { agentId: "b", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 1 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, config)
    expect(result.selectionReason).toBe("HIGHEST_CONFIDENCE")
  })

  test("marks selected candidate with selected: true", () => {
    const candidates: ProposalCandidate[] = [
      { agentId: "a", reasoningStrength: "low", rationale: "", proposedAction: "", tags: [], producedAt: 0 },
      { agentId: "b", reasoningStrength: "high", rationale: "", proposedAction: "", tags: [], producedAt: 1 },
    ]

    const result = ConfidenceReconciliationStrategy.reconcile(candidates, config)
    const selected = result.candidates.find((s) => s.selected)
    expect(selected).toBeDefined()
    expect(selected!.agentId).toBe("b")
  })
})
