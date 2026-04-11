import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    if (!input.model.api.id.includes("gpt-5-pro")) {
      result.reasoningEffort = "medium"
    }
  }

  return result
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (id === "o1-mini") return {}
  const efforts = ["low", "medium", "high"]
  if (id.includes("gpt-5-") || id === "gpt-5") {
    efforts.unshift("minimal")
  }
  return Object.fromEntries(
    efforts.map((effort) => [
      effort,
      {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    ]),
  )
}

export const small: Transform["small"] = () => {
  return {}
}
