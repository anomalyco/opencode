import type { Model } from "@opencode/schema/model"

export interface ModelTools {
  readonly hidden: Set<string>
  readonly codemode: Set<string>
}

export function modelTools(input: { readonly model?: Model.Info; readonly websearch: boolean }): ModelTools {
  const hidden = new Set<string>()
  const codemode = new Set<string>()
  if (!input.websearch) hidden.add("websearch")
  if (!input.model) return { hidden, codemode }

  const id = input.model.id.toLowerCase()
  const usePatch = id.includes("gpt-") && !id.includes("oss") && !id.includes("gpt-4")
  if (usePatch) {
    hidden.add("edit")
    hidden.add("write")
  }
  if (!usePatch) hidden.add("patch")

  if (isStrongModel(input.model)) {
    hidden.add("glob")
    hidden.add("grep")
    hidden.add("webfetch")
    for (const name of ["read", "write", "edit", "patch", "shell"]) {
      if (!hidden.has(name)) codemode.add(name)
    }
  }
  return { hidden, codemode }
}

function isStrongModel(model: Model.Info) {
  const id = model.id.toLowerCase()
  const modelID = model.modelID.toLowerCase()
  const family = model.family?.toLowerCase()
  if (id.includes("gpt") || modelID.includes("gpt")) return true
  return (
    model.providerID === "anthropic" ||
    model.canonical === "anthropic" ||
    id.includes("claude") ||
    modelID.includes("claude") ||
    Boolean(family?.includes("claude"))
  )
}
