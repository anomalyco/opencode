import type { ModelMessage } from "ai"
import type { Transform } from "../types"
import { ADAPTIVE_EFFORTS, applyCaching, isAnthropicAdaptive, normalizeAnthropic, scrubClaude } from "../shared"

export const normalize: NonNullable<Transform["normalize"]> = (msgs, _model) => {
  void _model
  return scrubClaude(normalizeAnthropic(msgs))
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
        budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
      },
    },
    max: {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(31_999, model.limit.output - 1),
      },
    },
  }
}

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}
  const modelId = input.model.api.id.toLowerCase()
  if (modelId.includes("k2p5") || modelId.includes("kimi-k2.5") || modelId.includes("kimi-k2p5")) {
    result.thinking = {
      type: "enabled",
      budgetTokens: Math.min(16_000, Math.floor(input.model.limit.output / 2 - 1)),
    }
  }
  return result
}

export const small: Transform["small"] = () => {
  return {}
}
