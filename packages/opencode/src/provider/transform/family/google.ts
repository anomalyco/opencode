import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}
  if (input.model.capabilities.reasoning) {
    result.thinkingConfig = {
      includeThoughts: true,
    }
    if (input.model.api.id.includes("gemini-3")) {
      result.thinkingConfig.thinkingLevel = "high"
    }
  }
  return result
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
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
  let levels = ["low", "high"]
  if (id.includes("3.1")) {
    levels = ["low", "medium", "high"]
  }
  return Object.fromEntries(
    levels.map((effort) => [
      effort,
      {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: effort,
        },
      },
    ]),
  )
}

export const small: Transform["small"] = (model) => {
  if (model.providerID === "google") {
    if (model.api.id.includes("gemini-3")) {
      return { thinkingConfig: { thinkingLevel: "minimal" } }
    }
    return { thinkingConfig: { thinkingBudget: 0 } }
  }
  return {}
}
