/**
 * Resolve final intent from explicit approval and model assessment.
 * Allow / Conditional / Deny instruction fit is scored by the classifier LLM
 * (see CLASSIFIER_PREAMBLE) — the host must not re-match those lines with regex.
 *
 * Precedence: explicit approval → high; otherwise keep model intent, capping
 * unauthorized high intent without an explicit current user prompt.
 */
export type DeriveInstructionIntentInput = {
  modelIntent: "high" | "medium" | "low"
  hasExplicitPrompt: boolean
  explicitApproval: boolean
}

export function deriveInstructionIntent(input: DeriveInstructionIntentInput): {
  intent: "high" | "medium" | "low"
  reason: string
} {
  if (input.explicitApproval) {
    return { intent: "high", reason: "User approved the assistant permission request for this action." }
  }

  if (input.modelIntent === "high" && !input.hasExplicitPrompt) {
    return {
      intent: "medium",
      reason: "High intent requires an explicit current user prompt.",
    }
  }

  return {
    intent: input.modelIntent,
    reason: "Classifier assessment.",
  }
}
