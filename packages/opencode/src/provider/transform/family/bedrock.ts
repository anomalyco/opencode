import type { Transform } from "../types"
import { ADAPTIVE_EFFORTS, applyCaching, isAnthropicAdaptive, normalizeAnthropic } from "../shared"

export const normalize: NonNullable<Transform["normalize"]> = (msgs, _model) => {
  void _model
  return normalizeAnthropic(msgs)
}

export const cache: NonNullable<Transform["cache"]> = (msgs, model) => {
  return applyCaching(msgs, model)
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  if (isAnthropicAdaptive(model)) {
    return Object.fromEntries(
      ADAPTIVE_EFFORTS.map((effort) => [
        effort,
        {
          reasoningConfig: {
            type: "adaptive",
            maxReasoningEffort: effort,
          },
        },
      ]),
    )
  }
  if (model.api.id.includes("anthropic")) {
    return {
      high: {
        reasoningConfig: {
          type: "enabled",
          budgetTokens: 16000,
        },
      },
      max: {
        reasoningConfig: {
          type: "enabled",
          budgetTokens: 31999,
        },
      },
    }
  }
  return Object.fromEntries(
    ["low", "medium", "high"].map((effort) => [
      effort,
      {
        reasoningConfig: {
          type: "enabled",
          maxReasoningEffort: effort,
        },
      },
    ]),
  )
}

export const options: Transform["options"] = () => {
  return {}
}

export const small: Transform["small"] = () => {
  return {}
}
