import type { Provider } from "@kancode/sdk/v2"

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

export type ModelShape = Provider["models"][string]

// Humanize a byte/token count as `128K`, `200K`, `1M`, `2M`.
// Uses 1000 base for readability of token context windows.
export function humanizeContext(tokens: number) {
  if (!tokens || tokens <= 0) return ""
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  const k = tokens / 1000
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`
}

// Humanize a per-1M-token cost as `$3` / `$0.30` / `$15`.
export function humanizeCost(cost: number) {
  if (!Number.isFinite(cost) || cost === 0) return "$0"
  if (Number.isInteger(cost)) return `$${cost}`
  // Two decimals for small fractional costs like $0.30, trim trailing zeros.
  return `$${cost.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`
}

// Joined `·`-separated capability glyphs for a model's capability line.
export function capabilityLine(model: ModelShape) {
  const caps = model.capabilities
  const parts: string[] = []
  if (caps?.reasoning) parts.push("reasoning")
  if (caps?.toolcall) parts.push("tools")
  if (caps?.attachment || caps?.input?.image || caps?.input?.pdf) parts.push("vision")
  if (caps?.input?.audio) parts.push("audio-in")
  if (caps?.output?.audio) parts.push("audio-out")
  if (caps?.output?.image) parts.push("image-out")
  if (model.status === "alpha") parts.push("ALPHA")
  if (model.status === "beta") parts.push("BETA")
  if (model.variants) {
    const n = Object.keys(model.variants).length
    if (n > 0) parts.push(`+${n} variant${n === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}
