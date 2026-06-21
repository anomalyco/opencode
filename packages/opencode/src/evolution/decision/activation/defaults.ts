import type { AgentCriteria } from "@/evolution/decision/agents/types"
import type { DecisionCriteria } from "@/evolution/decision/engine"

export interface ActivationDefaults {
  readonly criteria: AgentCriteria
  readonly decisionCriteria: DecisionCriteria
}

const DEFAULT_INSTRUCTION = "Evaluate current project state for architectural decisions that would improve code quality or project structure."

export const makeActivationDefaults = (
  overrides?: { instruction?: string; tags?: readonly string[] },
): ActivationDefaults => {
  const instruction = overrides?.instruction ?? DEFAULT_INSTRUCTION
  const tags = overrides?.tags ?? []
  return {
    criteria: { instruction, tags },
    decisionCriteria: {
      key: `manual-eval-${Date.now()}`,
      instruction,
      tags,
    },
  }
}
