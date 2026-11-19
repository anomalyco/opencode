import type { Model } from "@opencode/schema/model"

const codeModeBuiltIns = ["read", "write", "edit", "patch", "shell", "websearch"] as const
const fullCodeModeHidden = ["glob", "grep", "webfetch"] as const

export interface ModelTools {
  readonly hidden: Set<string>
  readonly direct: Set<string>
}

export function modelTools(input: {
  readonly model?: Model.Info
  readonly websearch: boolean
  readonly fullCodeMode: boolean
}): ModelTools {
  const hidden = new Set<string>()
  const direct = new Set<string>()
  if (!input.websearch) hidden.add("websearch")
  // Code Mode programs search and fetch through shell and their `fetch` global, so these tools only add noise.
  if (input.fullCodeMode) for (const name of fullCodeModeHidden) hidden.add(name)
  if (!input.model) {
    if (input.fullCodeMode) {
      for (const name of codeModeBuiltIns) {
        if (!hidden.has(name)) direct.add(name)
      }
    }
    return { hidden, direct }
  }

  const id = input.model.id.toLowerCase()
  const modelID = input.model.modelID.toLowerCase()
  const gpt = gptMode(id, modelID)
  if (gpt === "patch") {
    hidden.add("edit")
    hidden.add("write")
  } else {
    hidden.add("patch")
  }

  if (!input.fullCodeMode) return { hidden, direct }

  if (gpt !== undefined || isAnthropic(input.model, id, modelID)) return { hidden, direct }

  for (const name of codeModeBuiltIns) {
    if (!hidden.has(name)) direct.add(name)
  }
  return { hidden, direct }
}

function gptMode(id: string, modelID: string): "patch" | "edit" | undefined {
  if (!id.includes("gpt") && !modelID.includes("gpt")) return undefined
  const usePatch =
    (id.includes("gpt-") || modelID.includes("gpt-")) &&
    !id.includes("oss") &&
    !modelID.includes("oss") &&
    !id.includes("gpt-4") &&
    !modelID.includes("gpt-4")
  return usePatch ? "patch" : "edit"
}

function isAnthropic(model: Model.Info, id: string, modelID: string) {
  return (
    model.providerID === "anthropic" ||
    model.providerID === "claude-agent" ||
    model.canonical === "anthropic" ||
    model.canonical === "claude-agent" ||
    id.includes("claude") ||
    modelID.includes("claude") ||
    Boolean(model.family?.toLowerCase().includes("claude"))
  )
}
