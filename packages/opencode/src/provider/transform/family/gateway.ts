import { ADAPTIVE_EFFORTS, isAnthropicAdaptive, OPENAI_EFFORTS } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = () => {
  return {
    gateway: {
      caching: "auto",
    },
  }
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (model.id.includes("anthropic")) {
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
  if (model.id.includes("google")) {
    if (id.includes("2.5")) {
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
    return Object.fromEntries(
      ["low", "high"].map((effort) => [
        effort,
        {
          includeThoughts: true,
          thinkingLevel: effort,
        },
      ]),
    )
  }
  return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
}

export const small: Transform["small"] = () => {
  return {}
}
