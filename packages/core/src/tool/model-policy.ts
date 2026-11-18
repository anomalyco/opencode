import type { Model } from "@opencode/schema/model"

export interface ModelTools {
  readonly hidden: Set<string>
  readonly codemode: Set<string>
}

export function modelTools(input: {
  readonly model?: Model.Info
  readonly websearch: boolean
  readonly fullCodeMode: boolean
}): ModelTools {
  const hidden = new Set<string>()
  const codemode = new Set<string>()
  if (!input.websearch) hidden.add("websearch")
  if (!input.model) return { hidden, codemode }

  const id = input.model.id.toLowerCase()
  const modelID = input.model.modelID.toLowerCase()
  const gpt = gptMode(id, modelID)
  if (gpt === "patch") {
    hidden.add("edit")
    hidden.add("write")
  } else {
    hidden.add("patch")
  }

  if (input.fullCodeMode && (gpt !== undefined || isAnthropic(input.model, id, modelID))) {
    hidden.add("glob")
    hidden.add("grep")
    hidden.add("webfetch")
    for (const name of ["read", "write", "edit", "patch", "shell"]) {
      if (!hidden.has(name)) codemode.add(name)
    }
  }
  return { hidden, codemode }
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
