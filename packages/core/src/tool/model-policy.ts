import type { Model } from "@opencode/schema/model"

const fullCodeModeHidden = ["glob", "grep", "webfetch"] as const

export interface ModelTools {
  readonly hidden: Set<string>
  readonly direct: Set<string>
  readonly rawText: boolean
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
    for (const name of usesPatch(input.model) ? ["edit", "write"] : ["patch"]) hidden.add(name)
  }

  return { hidden, direct: new Set<string>(), rawText: input.model?.capabilities.freeform?.includes("text") === true }
}

function usesPatch(model: Model.Info) {
  const id = model.id.toLowerCase()
  const modelID = model.modelID.toLowerCase()
  return (
    (id.includes("gpt-") || modelID.includes("gpt-")) &&
    !id.includes("oss") &&
    !modelID.includes("oss") &&
    !id.includes("gpt-4") &&
    !modelID.includes("gpt-4")
  )
}
