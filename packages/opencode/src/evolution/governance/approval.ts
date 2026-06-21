import type { Decision, DecisionCategory } from "@/evolution/decision/p6-types"

const AUTO_EXECUTABLE_CATEGORIES = new Set<DecisionCategory>([
  "CONFIG_THRESHOLD",
  "CONFIG_BUDGET",
  "AGENT_INSTRUCTION",
])

export function isAutoExecutable(decision: Decision): boolean {
  if (decision.consensusOutcome !== "UNANIMOUS_APPROVED") return false
  return AUTO_EXECUTABLE_CATEGORIES.has(decision.category)
}

export function explainAutoExecutability(decision: Decision): string {
  if (decision.consensusOutcome !== "UNANIMOUS_APPROVED") {
    return `NOT_AUTO_EXECUTABLE — consensus outcome is ${decision.consensusOutcome}, not UNANIMOUS_APPROVED`
  }
  if (AUTO_EXECUTABLE_CATEGORIES.has(decision.category)) {
    return `AUTO_EXECUTABLE — category ${decision.category} is in the approved low-risk list`
  }
  return `NOT_AUTO_EXECUTABLE — category ${decision.category} requires manual human approval`
}

export * as Approval from "."
