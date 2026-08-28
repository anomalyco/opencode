import { DateTime } from "luxon"
import { firstBy, groupBy, values } from "remeda"

export function toVisibilityKey(model: { providerID: string; modelID: string }): string {
  return `${model.providerID}:${model.modelID}`
}

export type ModelVisibilityEntry = {
  providerID: string
  modelID: string
  id: string
  provider: { id: string }
  family?: string
  release_date?: string
}

function familyHeadKey(model: ModelVisibilityEntry): string {
  return `${model.providerID}:${model.family ?? ""}`
}

export function computeFamilyHeads(models: ModelVisibilityEntry[]): Set<string> {
  const groups = groupBy(models, familyHeadKey)
  const heads = values(groups)
    .flatMap((g) => {
      const head = firstBy(g, [(x) => x.release_date ?? "", "desc"])
      return head ? [toVisibilityKey(head)] : []
    })
  return new Set(heads)
}

export type VisibilityDecisionInput = {
  key: string
  visibility: ReadonlyMap<string, "show" | "hide">
  release: ReadonlyMap<string, DateTime>
  familyHeads: ReadonlySet<string>
}

export function isModelVisible(input: VisibilityDecisionInput): boolean {
  const state = input.visibility.get(input.key)
  if (state === "hide") return false
  if (state === "show") return true
  const date = input.release.get(input.key)
  if (!date?.isValid) return true
  return input.familyHeads.has(input.key)
}
