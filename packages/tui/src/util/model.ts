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

// Vision for fallback purposes matches runtime `unsupportedParts`:
// `capabilities.input.image` / `capabilities.input.pdf`. The legacy
// `attachment` catalog flag alone is not enough for the describe side-pass.
// Used by `DialogConfig` / `DialogFallback` and the `fallback-vision` token.
export function isVisionCapable(model: ModelShape): boolean {
  const caps = model.capabilities
  return Boolean(caps?.input?.image || caps?.input?.pdf)
}

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
//
// Order: `reasoning`, `tools`, `vision`, `audio-in`, `audio-out`, `image-out`,
// `ALPHA`/`BETA`, then `fallback-vision` (when the model has no vision but a
// fallback is set), then `+N variants`. The fallback-vision token is placed
// before the +N variants token so the visual "this model has a fallback"
// signal is not pushed off the right edge by a long variants list.
export function capabilityLine(
  model: ModelShape,
  fallback?: { providerID: string; modelID: string } | null,
) {
  const caps = model.capabilities
  const parts: string[] = []
  if (caps?.reasoning) parts.push("reasoning")
  if (caps?.toolcall) parts.push("tools")
  // Catalog `vision` chip still includes legacy `attachment`; fallback decisions use `isVisionCapable`.
  if (caps?.attachment || caps?.input?.image || caps?.input?.pdf) parts.push("vision")
  if (caps?.input?.audio) parts.push("audio-in")
  if (caps?.output?.audio) parts.push("audio-out")
  if (caps?.output?.image) parts.push("image-out")
  if (model.status === "alpha") parts.push("ALPHA")
  if (model.status === "beta") parts.push("BETA")
  if (fallback && !isVisionCapable(model)) {
    parts.push("fallback-vision")
  }
  if (model.variants) {
    const n = Object.keys(model.variants).length
    if (n > 0) parts.push(`+${n} variant${n === 1 ? "" : "s"}`)
  }
  return parts.join(" · ")
}

// Structured variant of `capabilityLine` that exposes per-token color hints
// so callers can render the `fallback-vision` token differently when the
// fallback is per-model (override) vs inherited from the global default.
// Returns an array of segments in the same order as `capabilityLine`.
//
// Color hints:
//   - `info`   — per-model override (`modelAttachmentFallback` entry is a
//                target object). Rendered with `theme.info`.
//   - `muted`  — inherited global fallback (no per-model entry). Rendered
//                with `theme.textMuted`, same as other capability tokens.
//
// `perModelEntry` MUST be the raw map value (target object, `null` for
// explicit opt-out, or `undefined` for no entry); do not pre-resolve via
// `fallbackFor`. `global` is accepted for call-site symmetry / future use.
export type CapabilitySegment = {
  text: string
  colorHint?: "muted" | "info"
}

export function capabilityLineSegments(
  model: ModelShape,
  fallback: { providerID: string; modelID: string } | null | undefined,
  _global: { providerID: string; modelID: string } | null | undefined,
  perModelEntry: { providerID: string; modelID: string } | null | undefined,
): CapabilitySegment[] {
  const caps = model.capabilities
  const segs: CapabilitySegment[] = []
  if (caps?.reasoning) segs.push({ text: "reasoning" })
  if (caps?.toolcall) segs.push({ text: "tools" })
  if (caps?.attachment || caps?.input?.image || caps?.input?.pdf) segs.push({ text: "vision" })
  if (caps?.input?.audio) segs.push({ text: "audio-in" })
  if (caps?.output?.audio) segs.push({ text: "audio-out" })
  if (caps?.output?.image) segs.push({ text: "image-out" })
  if (model.status === "alpha") segs.push({ text: "ALPHA" })
  if (model.status === "beta") segs.push({ text: "BETA" })
  if (fallback && !isVisionCapable(model)) {
    // Per-model target → info; inherited global → muted.
    const isPerModel = perModelEntry !== undefined && perModelEntry !== null
    segs.push({
      text: "fallback-vision",
      colorHint: isPerModel ? "info" : "muted",
    })
  }
  if (model.variants) {
    const n = Object.keys(model.variants).length
    if (n > 0) segs.push({ text: `+${n} variant${n === 1 ? "" : "s"}` })
  }
  return segs
}

// Join a capability-line segment list into a single " · "-delimited string.
// Used by callers that render the line on a single row (e.g. the model
// picker, which lays out each `option.details` entry on its own row). The
// `colorHint` is intentionally dropped — the joined string is plain text.
export function capabilityLineJoined(segs: CapabilitySegment[]): string {
  return segs.map((s) => s.text).join(" · ")
}
