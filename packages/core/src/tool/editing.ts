export * as ToolEditing from "./editing.js"

import type { Document, Entry } from "@opencode/schema/config"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { Model } from "@opencode/schema/model"

export const EDITING_TOOLS = ["patch", "edit", "write"] as const
export type EditingTool = (typeof EDITING_TOOLS)[number]
interface ModelRef {
  readonly providerID: string
  readonly id: string
}

export function configuredEditing(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.editing !== undefined,
  )?.info.experimental?.editing
}

export function editingTools(model: Model.Info, editing: ConfigExperimental.Editing | undefined) {
  const tools = new Set<EditingTool>(usesPatch(model) ? ["patch"] : ["edit", "write"])
  if (!editing) return tools
  const delta = matchingRule(model, editing) ?? editing
  for (const name of delta.add ?? []) tools.add(name)
  for (const name of delta.remove ?? []) tools.delete(name)
  return tools
}

export function editingResult(
  model: ModelRef | undefined,
  editing: ConfigExperimental.Editing | undefined,
): ConfigExperimental.EditingResult {
  if (!editing) return "summary"
  return matchingRule(model, editing)?.result_style ?? editing.result_style ?? "summary"
}

function matchingRule(model: ModelRef | undefined, editing: ConfigExperimental.Editing | undefined) {
  if (!model || !editing) return undefined
  return editing.rules?.findLast((candidate) =>
    new RegExp(candidate.match).test(`${model.providerID}/${model.id}`),
  )
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
