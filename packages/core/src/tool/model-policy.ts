import type { Model } from "@opencode/schema/model"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import { EDITING_TOOLS, editingTools } from "./editing.js"

const fullCodeModeHidden = ["glob", "grep", "webfetch"] as const

export interface ModelTools {
  readonly hidden: Set<string>
  readonly direct: Set<string>
}

export function modelTools(input: {
  readonly model?: Model.Info
  readonly websearch: boolean
  readonly fullCodeMode: boolean
  readonly editing?: ConfigExperimental.Editing
}): ModelTools {
  const hidden = new Set<string>()
  if (!input.websearch) hidden.add("websearch")
  // Code Mode programs search and fetch through shell and their `fetch` global, so these tools only add noise.
  if (input.fullCodeMode) for (const name of fullCodeModeHidden) hidden.add(name)

  // GPT-5+ edits with patch; every other model edits with edit and write.
  if (input.model) {
    const tools = editingTools(input.model, input.editing)
    for (const name of EDITING_TOOLS) {
      if (!tools.has(name)) hidden.add(name)
    }
  }

  return { hidden, direct: new Set<string>() }
}
