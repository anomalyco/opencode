import { ADAPTIVE_EFFORTS, isAnthropicAdaptive } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = () => {
  return {}
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (model.api.id.includes("anthropic")) {
    if (isAnthropicAdaptive(model)) {
      return Object.fromEntries(
        ADAPTIVE_EFFORTS.map((effort) => [
          effort,
          {
            thinking: {
              type: "adaptive",
            },
            effort,
          },
        ]),
      )
    }
    return {
      high: {
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      },
      max: {
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      },
    }
  }
  if (model.api.id.includes("gemini") && id.includes("2.5")) {
    return {
      high: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      },
      max: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      },
    }
  }
  if (model.api.id.includes("gpt") || /\bo[1-9]/.test(model.api.id)) {
    return Object.fromEntries(["low", "medium", "high"].map((effort) => [effort, { reasoningEffort: effort }]))
  }
  return {}
}

export const small: Transform["small"] = () => {
  return {}
}
