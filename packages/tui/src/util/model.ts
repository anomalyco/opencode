import type { Provider } from "@opencode-ai/sdk/v2"

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

/**
 * Returns the effective context limit for display purposes.
 * For split-window models (where input and output windows are separate),
 * this returns limit.input when available, otherwise limit.context.
 * This matches the actual prompt ceiling enforced by session/overflow.ts usable().
 */
export function contextLimit(model: { limit: { context: number; input?: number } } | undefined): number | undefined {
  if (!model) return undefined
  if (model.limit.input && model.limit.input > 0) return model.limit.input
  return model.limit.context || undefined
}
