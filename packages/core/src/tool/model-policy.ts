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
  if (!input.websearch) hidden.add("websearch")
  // Code Mode programs search and fetch through shell and their `fetch` global, so these tools only add noise.
  if (input.fullCodeMode) for (const name of fullCodeModeHidden) hidden.add(name)

  // GPT-5+ edits with patch; every other model edits with edit and write.
  if (input.model) {
    if (editMode(input.model) === "patch") {
      hidden.add("edit")
      hidden.add("write")
    } else {
      hidden.add("patch")
    }
  }

  // With full_codemode, strong models (GPT and Claude) use the built-ins from inside Code Mode;
  // every other model, or an unresolved one, keeps them as direct tools.
  const direct = new Set<string>()
  if (input.fullCodeMode && !strongModel(input.model)) {
    for (const name of codeModeBuiltIns) {
      if (!hidden.has(name)) direct.add(name)
    }
  }
  return { hidden, direct }
}

function editMode(model: Model.Info) {
  return gptMode(model.id.toLowerCase(), model.modelID.toLowerCase())
}

function strongModel(model: Model.Info | undefined) {
  if (!model) return false
  const id = model.id.toLowerCase()
  const modelID = model.modelID.toLowerCase()
  return gptMode(id, modelID) !== undefined || isAnthropic(model, id, modelID)
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
