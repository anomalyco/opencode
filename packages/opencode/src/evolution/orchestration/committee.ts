import type { AgentOutput, ConsensusResult, ContextAnalystOutput, RiskAnalystOutput, PlanningAnalystOutput } from "@/evolution/decision/p6-types"

function isContextAnalyst(o: AgentOutput): o is ContextAnalystOutput {
  return o.agentId === "context-analyst"
}

function isRiskAnalyst(o: AgentOutput): o is RiskAnalystOutput {
  return o.agentId === "risk-analyst"
}

function isPlanningAnalyst(o: AgentOutput): o is PlanningAnalystOutput {
  return o.agentId === "planning-analyst"
}

export function runCommittee(outputs: AgentOutput[]): ConsensusResult {
  const timestamp = Date.now()

  const proposals = outputs.filter(isContextAnalyst)
  const riskOutput = outputs.find(isRiskAnalyst) ?? null
  const planningOutputs = outputs.filter(isPlanningAnalyst)

  if (proposals.length === 0) {
    return { outcome: "NO_PROPOSAL", timestamp }
  }

  if (riskOutput !== null) {
    const isVeto = riskOutput.critical === true && riskOutput.recommendation !== "APPROVE"
    if (isVeto) {
      return {
        outcome: "VETO_HELD",
        vetoReason: `RiskAnalyst veto — assessment: ${riskOutput.assessment}, recommendation: ${riskOutput.recommendation}, reason: ${riskOutput.reason}`,
        timestamp,
      }
    }
  }

  const uniqueActions = new Set(proposals.map((p) => p.proposedAction))
  if (uniqueActions.size > 1) {
    return {
      outcome: "DISAGREEMENT_HELD",
      conflicts: proposals.map((p) => `[${p.agentId}] → "${p.proposedAction}"`),
      timestamp,
    }
  }

  const infeasible = planningOutputs.filter((p) => !p.feasible)
  if (infeasible.length > 0) {
    return {
      outcome: "DISAGREEMENT_HELD",
      conflicts: infeasible.map((p) => `[${p.agentId}] infeasible — "${p.reason}"`),
      timestamp,
    }
  }

  const agreedAction = proposals[0]!.proposedAction
  return { outcome: "UNANIMOUS_APPROVED", selectedAction: agreedAction, timestamp }
}

export function describeConsensus(result: ConsensusResult): string {
  switch (result.outcome) {
    case "UNANIMOUS_APPROVED":
      return `APPROVED — action: "${result.selectedAction}"`
    case "VETO_HELD":
      return `VETO_HELD — ${result.vetoReason}`
    case "DISAGREEMENT_HELD":
      return `DISAGREEMENT_HELD — conflicts: ${(result.conflicts ?? []).join("; ")}`
    case "NO_PROPOSAL":
      return "NO_PROPOSAL — no proposal-capable agent produced output"
  }
}

export * as Committee from "."
