import type { Model, Provider } from "@opencode-ai/sdk/v2"

export function parse(value: string) {
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function index(list: Provider[] | undefined) {
  return new Map((list ?? []).map((item) => [item.id, item] as const))
}

export function get(list: Provider[] | ReadonlyMap<string, Provider> | undefined, providerID: string, modelID: string) {
  const provider =
    list instanceof Map
      ? list.get(providerID)
      : Array.isArray(list)
        ? list.find((item) => item.id === providerID)
        : undefined
  return provider?.models[modelID]
}

export function name(
  list: Provider[] | ReadonlyMap<string, Provider> | undefined,
  providerID: string,
  modelID: string,
) {
  return get(list, providerID, modelID)?.name ?? modelID
}

export function contextLimit(model: Pick<Model, "limit"> | undefined) {
  const input = model?.limit.input
  if (typeof input === "number" && input > 0) return input

  const context = model?.limit.context
  if (typeof context === "number" && context > 0) return context
}

export function contextPercent(tokens: number, model: Pick<Model, "limit"> | undefined) {
  const limit = contextLimit(model)
  return limit ? Math.round((tokens / limit) * 100) : undefined
}
