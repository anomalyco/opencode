import { Model } from "@opencode/schema/model"

/** The old Superbot Fast Priority ID still refers to the same tier after it was named Fast. */
export function modelAlias(providerID: string, id: string) {
  if (providerID === "superbot-gg" && id === "superbot-fast-priority") return Model.ID.make("superbot-fast-fast")
}

export function lookupModel<T>(providerID: string, id: Model.ID, get: (id: Model.ID) => T | undefined) {
  const exact = get(id)
  if (exact !== undefined) return exact
  const alias = modelAlias(providerID, id)
  return alias ? get(alias) : undefined
}

export function findModelByID<T extends { providerID: string; id: string }>(
  models: readonly T[] | undefined,
  providerID: string,
  id: string,
) {
  return lookupModel(providerID, Model.ID.make(id), (id) =>
    models?.find((model) => model.providerID === providerID && model.id === id),
  )
}
