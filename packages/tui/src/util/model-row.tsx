import { TextAttributes, type RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import type { Provider } from "@kancode/sdk/v2"
import type { DialogSelectOption } from "../ui/dialog-select"
import { Locale } from "./locale"
import { capabilityLine, humanizeContext, humanizeCost, type ModelShape } from "./model"

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
  onSelect?: () => void
}

// Compose the right-aligned footer token: cost · context · ★ · ✎note.
// Returns the JSX element and the visible character width so the caller can
// shrink the title's `titleWidth` to avoid collision.
function footerTokens(
  model: ModelShape,
  opts: ModelRowOptions,
  theme: ModelRowTheme,
): { view: JSX.Element; width: number } {
  const cost = humanizeCost(model.cost?.input ?? 0)
  const out = humanizeCost(model.cost?.output ?? 0)
  const costText = `${cost}/${out}`
  const free = model.cost?.input === 0
  const ctx = humanizeContext(model.limit?.context ?? 0)
  const star = opts.favorite ? "★" : ""
  const note = opts.note ? "✎" : ""

  const pieces: { text: string; color: RGBA }[] = []
  pieces.push({ text: costText, color: free ? theme.success : theme.textMuted })
  if (ctx) pieces.push({ text: ctx, color: theme.textMuted })
  if (star) pieces.push({ text: star, color: theme.warning })
  if (note) pieces.push({ text: note, color: theme.info })

  const width = pieces.reduce((acc, p) => acc + p.text.length + 1, -1)
  return {
    width,
    view: (
      <text>
        {pieces.map((p, i) => (
          <>
            {i > 0 ? <span> </span> : null}
            <span style={{ fg: p.color }}>{p.text}</span>
          </>
        ))}
      </text>
    ),
  }
}

// Provider header: name + visible-model count + price range.
function providerHeader(provider: Provider, visibleModels: ModelShape[], theme: ModelRowTheme): JSX.Element {
  const inputs = visibleModels.map((m) => m.cost?.input ?? 0).filter((n) => n > 0)
  let range = ""
  if (inputs.length > 0) {
    const min = Math.min(...inputs)
    const max = Math.max(...inputs)
    range = min === max ? humanizeCost(min) : `${humanizeCost(min)}–${humanizeCost(max)}`
  }
  return (
    <text>
      <span style={{ fg: theme.accent, attributes: TextAttributes.BOLD }}>{provider.name}</span>
      <span style={{ fg: theme.textMuted }}> · {visibleModels.length}</span>
      {range ? <span style={{ fg: theme.textMuted }}> · {range}</span> : null}
    </text>
  )
}

// Build a DialogSelectOption for a model row with rich metadata.
export function modelRow(
  model: ModelShape,
  modelID: string,
  provider: Provider,
  visiblePeers: ModelShape[],
  theme: ModelRowTheme,
  opts: ModelRowOptions & { onSelect: () => void },
): DialogSelectOption<{ providerID: string; modelID: string }> {
  const { view: footerView, width: footerWidth } = footerTokens(model, opts, theme)
  const capLine = capabilityLine(model)
  // Default title budget from DialogSelect.Option is 61; reserve room for the footer + 3 (padding).
  const titleWidth = Math.max(20, 61 - footerWidth - 1)
  const noteText = opts.note ? Locale.truncateMiddle(opts.note, 24) : undefined
  return {
    value: { providerID: provider.id, modelID },
    title: model.name ?? modelID,
    titleWidth,
    truncateTitle: true,
    footer: (
      <box flexDirection="row" gap={1}>
        {footerView}
        {noteText ? <text fg={theme.info}>{noteText}</text> : null}
      </box>
    ),
    details: capLine ? [capLine] : undefined,
    categoryView: providerHeader(provider, visiblePeers, theme),
    onSelect: opts.onSelect,
  }
}

export { providerHeader }