import { iife } from "@/util/iife"
import { WIDELY_SUPPORTED_EFFORTS } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = () => {
  return { store: false }
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (id.includes("gemini")) return {}
  if (id.includes("claude")) {
    return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
  }
  const efforts = iife(() => {
    if (id.includes("5.1-codex-max") || id.includes("5.2") || id.includes("5.3"))
      return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
    const arr = [...WIDELY_SUPPORTED_EFFORTS]
    if (id.includes("gpt-5") && model.release_date >= "2025-12-04") arr.push("xhigh")
    return arr
  })
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

export const small: Transform["small"] = (model) => {
  if (model.api.id.includes("gpt-5")) {
    if (model.api.id.includes("5.")) {
      return { store: false, reasoningEffort: "low" }
    }
    return { store: false, reasoningEffort: "minimal" }
  }
  return { store: false }
}
