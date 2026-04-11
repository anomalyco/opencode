import type { Transform, Variants } from "../types"

export const options: Transform["options"] = () => {
  return {}
}

export const variants = ((model): Variants => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (id.includes("grok-3-mini")) {
    return {
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    }
  }
  return {}
}) satisfies Transform["variants"]

export const small: Transform["small"] = () => {
  return {}
}
