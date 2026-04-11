import { OPENAI_EFFORTS } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {
    usage: {
      include: true,
    },
  }
  if (input.model.api.id.includes("gemini-3")) {
    result.reasoning = { effort: "high" }
  }
  result.prompt_cache_key = input.sessionID
  return result
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (id.includes("grok-3-mini")) {
    return {
      low: { reasoning: { effort: "low" } },
      high: { reasoning: { effort: "high" } },
    }
  }
  if (id.includes("grok")) return {}
  if (!model.id.includes("gpt") && !model.id.includes("gemini-3") && !model.id.includes("claude")) return {}
  return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))
}

export const small: Transform["small"] = (model) => {
  if (model.api.id.includes("google")) {
    return { reasoning: { enabled: false } }
  }
  return { reasoningEffort: "minimal" }
}
