import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createResource, For, Show } from "solid-js"

import { useTheme } from "../context/theme"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { getScrollAcceleration } from "@tui/util/scroll"

export type DialogSessionContextProps = {
  sessionID: string
  providerID: string
  modelID: string
}

// Format a token count as `12.3k` for >=1000, plain otherwise.
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

// Render a horizontal bar using block glyphs.
function bar(fraction: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, fraction))
  const filled = Math.round(clamped * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

// Shorten long filesystem paths by replacing a middle segment with `…`.
function shortenPath(s: string, max: number): string {
  if (s.length <= max) return s
  const keep = Math.max(8, Math.floor((max - 1) / 2))
  return s.slice(0, keep) + "…" + s.slice(s.length - keep)
}

export function DialogSessionContext(props: DialogSessionContextProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const term = useTerminalDimensions()
  dialog.setSize("full")

  const [info] = createResource(
    () => ({ sessionID: props.sessionID, providerID: props.providerID, modelID: props.modelID }),
    async (input) => {
      const result = await sdk.client.session.context(input)
      return result.data
    },
  )

  // Dialog uses "full" size: ~height/12 top padding from the framework.
  // Header block is ~9 lines (title, model row, ctx row, bar, in/out row,
  // blank, breakdown hint, blank). Reserve for chrome + bottom padding too.
  const scrollHeight = () => {
    const topPad = Math.max(1, Math.floor(term().height / 12))
    const headerRows = 10
    const chrome = 3
    return Math.max(6, term().height - topPad - headerRows - chrome)
  }
  // Width cap for per-item labels so long absolute paths don't dominate.
  const itemLabelMax = () => Math.max(32, Math.floor(term().width * 0.6))

  // Color scale for usage bar.
  const pressureColor = (frac: number, overflow: boolean, overBudget: boolean) => {
    if (overflow || overBudget) return theme.error
    if (frac >= 0.9) return theme.error
    if (frac >= 0.7) return theme.warning
    return theme.success
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={info.loading}>
        <text fg={theme.textMuted}>Computing breakdown...</text>
      </Show>

      <Show when={info.error}>
        <text fg={theme.error}>{info.error instanceof Error ? info.error.message : "Failed to load context"}</text>
      </Show>

      <Show when={info()}>
        {(data) => {
          const usage = () => data().usage
          const denom = () => usage().usable
          const fraction = () => (denom() > 0 ? usage().current / denom() : 0)
          const barColor = () => pressureColor(fraction(), usage().overflow, usage().overBudget)
          return (
            <box gap={1}>
              {/* Header / authoritative usage — always visible, never scrolled. */}
              <box>
                <text fg={theme.text}>
                  <b>{data().model.providerID}</b>
                  <span style={{ fg: theme.textMuted }}>/{data().model.modelID}</span>
                  <span style={{ fg: theme.textMuted }}>{"   agent "}</span>
                  <b>{data().agent}</b>
                </text>
                <text fg={theme.textMuted}>
                  ctx {formatTokens(usage().contextLimit)} · usable {formatTokens(usage().usable)} · reserve{" "}
                  {formatTokens(usage().outputReserve)}
                </text>
                <text>
                  <span style={{ fg: barColor() }}>{bar(fraction(), 40)}</span>
                  <span style={{ fg: theme.text }}>
                    {"  "}
                    {formatTokens(usage().current)} / {formatTokens(denom())}
                  </span>
                  <span style={{ fg: theme.textMuted }}> ({(fraction() * 100).toFixed(1)}%)</span>
                  {usage().overflow ? (
                    <span style={{ fg: theme.error }}>{"  OVERFLOW — compaction pending"}</span>
                  ) : null}
                  {usage().overBudget && !usage().overflow ? (
                    <span style={{ fg: theme.warning }}>{"  OVER BUDGET — auto-compaction disabled"}</span>
                  ) : null}
                </text>
                <Show when={usage().authoritative}>
                  <text fg={theme.textMuted}>
                    in {formatTokens(usage().input)} · out {formatTokens(usage().output)}
                    {usage().reasoning > 0 ? ` · reasoning ${formatTokens(usage().reasoning)}` : ""}
                    {usage().cacheRead > 0 ? ` · cache r ${formatTokens(usage().cacheRead)}` : ""}
                    {usage().cacheWrite > 0 ? ` · cache w ${formatTokens(usage().cacheWrite)}` : ""}
                  </text>
                </Show>
                <Show when={!usage().authoritative}>
                  <text fg={theme.textMuted}>no assistant turn yet — breakdown below is estimated</text>
                </Show>
              </box>

              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Breakdown (estimated · chars/4)</text>
                <text fg={theme.textMuted}>↑↓ pgup pgdn scroll</text>
              </box>

              {/* Scrollable diagnostic breakdown. */}
              <scrollbox height={scrollHeight()} scrollAcceleration={getScrollAcceleration()}>
                <box gap={1} paddingRight={2}>
                  <For each={data().sections}>
                    {(section) => {
                      // Group items by `group` field when present; renders a
                      // subheader per group with subtotal (e.g. MCP servers).
                      const grouped = () => {
                        const map = new Map<string, typeof section.items>()
                        for (const it of section.items) {
                          const k = it.group ?? ""
                          if (!map.has(k)) map.set(k, [])
                          map.get(k)!.push(it)
                        }
                        return Array.from(map.entries())
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([g, items]) => ({
                            group: g,
                            items,
                            tokens: items.reduce((acc, it) => acc + it.tokens, 0),
                          }))
                      }
                      const hasGroups = () => section.items.some((i) => i.group)
                      return (
                        <box>
                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme.text} attributes={TextAttributes.BOLD}>
                              {section.label}
                            </text>
                            <text fg={theme.textMuted}>
                              ~{formatTokens(section.tokens)} · {section.items.length}
                            </text>
                          </box>
                          <Show
                            when={hasGroups()}
                            fallback={
                              <For each={section.items}>
                                {(item) => (
                                  <box flexDirection="row" gap={1}>
                                    <text flexShrink={0} fg={theme.textMuted}>
                                      ·
                                    </text>
                                    <text fg={theme.text} wrapMode="word">
                                      {shortenPath(item.label, itemLabelMax())}
                                      <span style={{ fg: theme.textMuted }}>
                                        {"  ~"}
                                        {formatTokens(item.tokens)}
                                        {item.detail ? ` — ${item.detail}` : ""}
                                      </span>
                                    </text>
                                  </box>
                                )}
                              </For>
                            }
                          >
                            <For each={grouped()}>
                              {(g) => (
                                <box>
                                  <box flexDirection="row" justifyContent="space-between">
                                    <text fg={theme.text}>
                                      <span style={{ fg: theme.textMuted }}>▸ </span>
                                      {g.group || "ungrouped"}
                                    </text>
                                    <text fg={theme.textMuted}>
                                      ~{formatTokens(g.tokens)} · {g.items.length}
                                    </text>
                                  </box>
                                  <For each={g.items}>
                                    {(item) => (
                                      <box flexDirection="row" gap={1} paddingLeft={2}>
                                        <text flexShrink={0} fg={theme.textMuted}>
                                          ·
                                        </text>
                                        <text fg={theme.text} wrapMode="word">
                                          {shortenPath(item.label, itemLabelMax())}
                                          <span style={{ fg: theme.textMuted }}>
                                            {"  ~"}
                                            {formatTokens(item.tokens)}
                                          </span>
                                        </text>
                                      </box>
                                    )}
                                  </For>
                                </box>
                              )}
                            </For>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </scrollbox>
            </box>
          )
        }}
      </Show>
    </box>
  )
}
