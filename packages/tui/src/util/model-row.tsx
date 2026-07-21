import { TextAttributes, type RGBA } from "@opentui/core"
import { Show, type JSX } from "solid-js"
import type { Provider } from "@kancode/sdk/v2"
import type { DialogSelectOption } from "../ui/dialog-select"
import {
  capabilityLine,
  type CapabilitySegment,
  type ModelShape,
  humanizeContext,
  humanizeCost,
} from "./model"

export interface ModelRowTheme {
  text: RGBA
  textMuted: RGBA
  success: RGBA
  warning: RGBA
  info: RGBA
  accent: RGBA
}

export interface ModelRowOptions {
  favorite?: boolean
  note?: string
  current?: boolean
  // Override: treat this row as subscription (hide cost) even if the provider
  // id isn't in SUBSCRIPTION_PROVIDERS. Used for providers like `openai` whose
  // subscription vs metered status depends on the active auth method.
  subscription?: boolean
  // Effective vision-fallback target for this model (already resolved via
  // `local.model.fallbackFor(model)`). When set, the capability line appends
  // the `fallback-vision` token for non-vision models (no `attachment`, no
  // `input.image`, no `input.pdf`).
  fallback?: { providerID: string; modelID: string } | null
  // Pre-computed capability-line segments (preferred). When set, the row
  // renders a single `{ parts }` detail so `fallback-vision` can use
  // `theme.info` for per-model overrides while other tokens stay muted.
  // Falls back to a plain joined string via `capabilityLineText` / `capabilityLine`.
  capabilitySegments?: CapabilitySegment[]
  // The pre-computed capability-line string to render when segments are not
  // supplied. Kept for callers that do not need per-token color.
  capabilityLineText?: string
  onSelect?: () => void
}

// Providers whose usage is covered by a flat subscription rather than
// per-token metering. Cost tokens are hidden for these providers since the
// catalog's per-token prices don't reflect what the user actually pays.
// (opencode Zen is pay-as-you-go, so it is NOT here — its free endpoints
// surface as "Free" via the per-model cost check below.)
const SUBSCRIPTION_PROVIDERS = new Set(["github-copilot", "opencode-go", "ollama-cloud"])

function isSubscriptionProvider(providerID: string) {
  return SUBSCRIPTION_PROVIDERS.has(providerID)
}
export { isSubscriptionProvider }

// A model on a metered provider is free when its per-token input cost is 0.
function isFreeModel(model: ModelShape) {
  return (model.cost?.input ?? 0) === 0
}

// Compose the right-aligned footer token: cost · context · ★.
// Returns the JSX element and the visible character width so the caller can
// shrink the title's `titleWidth` to avoid collision.
function footerTokens(
  model: ModelShape,
  provider: Provider,
  opts: ModelRowOptions,
  theme: ModelRowTheme,
): { view: JSX.Element; width: number } {
  const ctx = humanizeContext(model.limit?.context ?? 0)
  const star = opts.favorite ? "★" : ""
  const subscription = isSubscriptionProvider(provider.id) || opts.subscription === true

  const pieces: { text: string; color: RGBA }[] = []
  if (subscription) {
    // Subscription providers: no per-token pricing to display.
  } else if (isFreeModel(model)) {
    pieces.push({ text: "Free", color: theme.success })
  } else {
    const cost = humanizeCost(model.cost?.input ?? 0)
    const out = humanizeCost(model.cost?.output ?? 0)
    pieces.push({ text: `${cost}/${out}`, color: theme.textMuted })
  }
  if (ctx) pieces.push({ text: ctx, color: theme.textMuted })
  if (star) pieces.push({ text: star, color: theme.warning })

  // Visible width: sum of piece lengths + 1 space between each.
  const width = pieces.reduce((acc, p, i) => acc + p.text.length + (i > 0 ? 1 : 0), 0)
  return {
    width,
    view: (
      <box flexDirection="row">
        {pieces.map((p, i) => (
          <text fg={p.color}>{i > 0 ? ` ${p.text}` : p.text}</text>
        ))}
      </box>
    ),
  }
}

// Provider header: name + visible-model count + price range.
// Subscription providers omit the price range (flat fee, not per-token).
function providerHeader(provider: Provider, visibleModels: ModelShape[], theme: ModelRowTheme): JSX.Element {
  const paidInputs = isSubscriptionProvider(provider.id)
    ? []
    : visibleModels.map((m) => m.cost?.input ?? 0).filter((n) => n > 0)
  let range = ""
  if (paidInputs.length > 0) {
    const min = Math.min(...paidInputs)
    const max = Math.max(...paidInputs)
    range = min === max ? humanizeCost(min) : `${humanizeCost(min)}–${humanizeCost(max)}`
  }
  return (
    <box flexDirection="row">
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        {provider.name}
      </text>
      <text fg={theme.textMuted}> · {visibleModels.length}</text>
      <Show when={range}>
        <text fg={theme.textMuted}> · {range}</text>
      </Show>
    </box>
  )
}

export type ModelRowBuildOptions = ModelRowOptions & {
  onSelect: () => void
  /** When set, attach a provider header (DialogSelect grouped view). Omit in the two-pane list. */
  peers?: ModelShape[]
  /** Prefer a plain string footer to avoid allocating JSX trees for every row. */
  plainFooter?: boolean
}

// Build a DialogSelectOption for a model row with rich metadata.
export function modelRow(
  model: ModelShape,
  modelID: string,
  provider: Provider,
  theme: ModelRowTheme,
  opts: ModelRowBuildOptions,
): DialogSelectOption<{ providerID: string; modelID: string }> {
  const plainFooter = opts.plainFooter === true
  const labeled = plainFooter ? footerLabel(model, provider, opts) : undefined
  const tokens = plainFooter ? undefined : footerTokens(model, provider, opts, theme)
  const footer = plainFooter ? labeled : tokens!.view
  const footerWidth = plainFooter ? (labeled?.length ?? 0) : tokens!.width
  // Prefer structured segments so `fallback-vision` can be colored (info for
  // per-model, muted for global). Fall back to a plain joined string for
  // callers that do not pass segments.
  const segs = opts.capabilitySegments
  const capLine = opts.capabilityLineText ?? capabilityLine(model, opts.fallback)
  const details: NonNullable<DialogSelectOption<
    { providerID: string; modelID: string }
  >["details"]> = segs && segs.length > 0
    ? [
        {
          parts: segs.map((s) => ({
            text: s.text,
            color: s.colorHint === "info" ? "info" : "muted",
          })),
        },
      ]
    : capLine
      ? [capLine]
      : []
  // Default title budget from DialogSelect.Option is 61; reserve room for the footer + 3 (padding).
  const titleWidth = Math.max(20, 61 - footerWidth - 1)
  return {
    value: { providerID: provider.id, modelID },
    title: model.name ?? modelID,
    titleWidth,
    truncateTitle: true,
    footer,
    details,
    categoryView: opts.peers ? providerHeader(provider, opts.peers, theme) : undefined,
    onSelect: opts.onSelect,
  }
}

function footerLabel(model: ModelShape, provider: Provider, opts: ModelRowOptions) {
  const ctx = humanizeContext(model.limit?.context ?? 0)
  const star = opts.favorite ? "★" : ""
  const subscription = isSubscriptionProvider(provider.id) || opts.subscription === true
  const pieces: string[] = []
  if (!subscription) {
    if (isFreeModel(model)) pieces.push("Free")
    else {
      const cost = humanizeCost(model.cost?.input ?? 0)
      const out = humanizeCost(model.cost?.output ?? 0)
      pieces.push(`${cost}/${out}`)
    }
  }
  if (ctx) pieces.push(ctx)
  if (star) pieces.push(star)
  if (pieces.length === 0) return undefined
  return pieces.join(" ")
}

export { providerHeader }
