import { iife } from "@/util/iife"
import type { Provider } from "../../provider"
import { OPENAI_EFFORTS, WIDELY_SUPPORTED_EFFORTS } from "../shared"
import type { Transform } from "../types"

function isOpenAIStore(model: Provider.Model) {
  return model.providerID === "openai" || model.api.npm === "@ai-sdk/openai"
}

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}

  if (isOpenAIStore(input.model)) {
    result.store = false
  }

  if (input.model.providerID === "openai" || input.providerOptions?.setCacheKey) {
    result.promptCacheKey = input.sessionID
  }

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    if (!input.model.api.id.includes("gpt-5-pro")) {
      result.reasoningEffort = "medium"
      result.reasoningSummary = "auto"
    }

    if (
      input.model.api.id.includes("gpt-5.") &&
      !input.model.api.id.includes("codex") &&
      !input.model.api.id.includes("-chat")
    ) {
      result.textVerbosity = "low"
    }
  }

  return result
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (id === "gpt-5-pro") return {}

  const efforts = iife(() => {
    if (id.includes("codex")) {
      if (id.includes("5.2") || id.includes("5.3")) return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
      return WIDELY_SUPPORTED_EFFORTS
    }
    const arr = [...WIDELY_SUPPORTED_EFFORTS]
    if (id.includes("gpt-5-") || id === "gpt-5") {
      arr.unshift("minimal")
    }
    if (model.release_date >= "2025-11-13") {
      arr.unshift("none")
    }
    if (model.release_date >= "2025-12-04") {
      arr.push("xhigh")
    }
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
  if (isOpenAIStore(model)) {
    if (model.api.id.includes("gpt-5")) {
      if (model.api.id.includes("5.")) {
        return { store: false, reasoningEffort: "low" }
      }
      return { store: false, reasoningEffort: "minimal" }
    }
    return { store: false }
  }

  return {}
}
