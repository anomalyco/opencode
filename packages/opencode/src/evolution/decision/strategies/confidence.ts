import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"
import { SCORING_CONTRACT } from "@/evolution/decision/proposal-candidate"
import type {
  ReconciliationStrategy,
  ReconciliationResult,
  CandidateSummary,
  AdvisorContext,
} from "@/evolution/decision/reconciliation-log"
import type { ReconciliationReason } from "@/evolution/decision/reconciliation-log"

function checkHELDVeto(ctx?: AdvisorContext): boolean {
  if (!ctx?.riskAssessment) return false
  const ra = ctx.riskAssessment
  return ra.overallSeverity === "critical" && ra.recommendationCategory === "REJECT"
}

export const ConfidenceReconciliationStrategy: ReconciliationStrategy = {
  name: "CONFIDENCE",

  reconcile: (
    candidates: readonly ProposalCandidate[],
    config: { minCandidateConfidence: number },
    advisorContext?: AdvisorContext,
  ): ReconciliationResult => {
    if (candidates.length === 0) {
      return {
        outcome: "NO_CANDIDATES",
        selectedCandidate: null,
        selectedCandidateAgentId: null,
        selectionReason: "NO_CANDIDATES",
        candidates: [],
      }
    }

    const minConfidence = config.minCandidateConfidence ?? 0.3

    // Check HELD veto FIRST — risk agent override before any selection
    if (checkHELDVeto(advisorContext)) {
      return {
        outcome: "HELD_FOR_REVIEW",
        selectedCandidate: null,
        selectedCandidateAgentId: null,
        selectionReason: "HELD_FOR_REVIEW",
        candidates: candidates.map((c) => ({
          agentId: c.agentId,
          reasoningStrength: c.reasoningStrength,
          confidenceScore: SCORING_CONTRACT[c.reasoningStrength],
          selected: false,
          rejectionReason: "RiskAgent veto — HELD for human review",
        })),
      }
    }

    const summaries: CandidateSummary[] = candidates.map((c) => ({
      agentId: c.agentId,
      reasoningStrength: c.reasoningStrength,
      confidenceScore: SCORING_CONTRACT[c.reasoningStrength],
      selected: false,
    }))

    const maxConfidence = Math.max(...summaries.map((s) => s.confidenceScore))

    if (maxConfidence < minConfidence) {
      return {
        outcome: "BELOW_THRESHOLD",
        selectedCandidate: null,
        selectedCandidateAgentId: null,
        selectionReason: "BELOW_THRESHOLD",
        candidates: summaries.map((s) => ({
          ...s,
          selected: false,
          rejectionReason: `confidence ${s.confidenceScore} < threshold ${minConfidence}`,
        })),
      }
    }

    // Single candidate — auto-select (no consensus issue)
    if (candidates.length === 1) {
      const selected = candidates[0]
      const selectedSummary = summaries[0]
      return {
        outcome: "PROPOSAL_SUBMITTED",
        selectedCandidate: selected,
        selectedCandidateAgentId: selected.agentId,
        selectionReason: "HIGHEST_CONFIDENCE",
        candidates: [{ ...selectedSummary, selected: true }],
      }
    }

    // KONSENSUS > SKOR: check agreement on proposedAction
    const actions = candidates.map((c) => c.proposedAction.toLowerCase().trim())
    const actionCounts = new Map<string, { count: number; indices: number[] }>()
    for (let i = 0; i < actions.length; i++) {
      const existing = actionCounts.get(actions[i]) ?? { count: 0, indices: [] }
      existing.count++
      existing.indices.push(i)
      actionCounts.set(actions[i], existing)
    }
    const maxAgreement = Math.max(...actionCounts.values().map((v) => v.count))
    const consensusGroup = [...actionCounts.values()].find((v) => v.count === maxAgreement)

    // If strict majority consensus (> half)
    if (consensusGroup && maxAgreement > candidates.length / 2) {
      // Select highest confidence within the consensus group
      const groupCandidates = consensusGroup.indices.map((i) => ({ index: i, candidate: candidates[i], confidence: summaries[i].confidenceScore }))
      const best = groupCandidates.reduce((a, b) => a.confidence > b.confidence ? a : b)
      const bestSummary = summaries[best.index]

      return {
        outcome: "PROPOSAL_SUBMITTED",
        selectedCandidate: best.candidate,
        selectedCandidateAgentId: best.candidate.agentId,
        selectionReason: "HIGHEST_CONFIDENCE",
        candidates: summaries.map((s, i) => ({
          ...s,
          selected: i === best.index,
          rejectionReason: i === best.index ? undefined : `consensus group selected ${candidates[best.index].agentId}`,
        })),
      }
    }

    // No consensus — fall back to highest confidence
    const bestIndex = summaries.reduce((best, s, i, arr) => {
      const current = arr[best]
      if (s.confidenceScore > current.confidenceScore) return i
      if (s.confidenceScore === current.confidenceScore && s.agentId < current.agentId) return i
      return best
    }, 0)

    const selected = candidates[bestIndex]
    const selectedSummary = summaries[bestIndex]

    return {
      outcome: "PROPOSAL_SUBMITTED",
      selectedCandidate: selected,
      selectedCandidateAgentId: selected.agentId,
      selectionReason: "HIGHEST_CONFIDENCE",
      candidates: summaries.map((s, i) => ({
        ...s,
        selected: i === bestIndex,
        rejectionReason: i === bestIndex ? undefined : `confidence ${s.confidenceScore} not highest`,
      })),
    }
  },
}

export * as EvolutionConfidenceReconciliationStrategy from "./confidence"
