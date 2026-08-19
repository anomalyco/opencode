import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useTuiConfig } from "../config"
import { getScrollAcceleration } from "../util/scroll"
import {
  formatCreditsLabel,
  formatPlanType,
  formatUsageResetAbsolute,
  usageDisplay,
  type UsageDisplayMode,
  formatUsageWindowLabel,
  usageBarColor,
  usageBarString,
} from "./usage-format"
import { hasUsageSnapshot, type UsageResult, type UsageWindow } from "./usage-data"
import { For, Show, createMemo, createSignal } from "solid-js"

type Theme = ReturnType<typeof useTheme>["theme"]

export function DialogUsage(props: { results: UsageResult[]; initialMode?: UsageDisplayMode }) {
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const [hover, setHover] = createSignal(false)
  const [mode, setMode] = createSignal<UsageDisplayMode>(props.initialMode ?? tuiConfig.show_usage_value_mode ?? "used")

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const dialogChromeRows = 6
  const scrollHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.75) - dialogChromeRows))
  const hasContent = createMemo(() => props.results.length > 0)

  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      setMode((value) => (value === "used" ? "remaining" : "used"))
      return
    }
    if (!scroll) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      scroll.scrollBy(-1)
    } else if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      scroll.scrollBy(1)
    } else if (evt.name === "pageup") {
      evt.preventDefault()
      scroll.scrollBy(-Math.max(1, Math.floor(scrollHeight() / 2)))
    } else if (evt.name === "pagedown") {
      evt.preventDefault()
      scroll.scrollBy(Math.max(1, Math.floor(scrollHeight() / 2)))
    } else if (evt.name === "home") {
      evt.preventDefault()
      scroll.scrollTo(0)
    } else if (evt.name === "end") {
      evt.preventDefault()
      scroll.scrollTo(scroll.scrollHeight)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>tab</span> toggle view
          </text>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={hover() ? theme.primary : undefined}
            onMouseOver={() => setHover(true)}
            onMouseOut={() => setHover(false)}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={hover() ? theme.selectedListItemText : theme.textMuted}>esc</text>
          </box>
        </box>
      </box>
      <Show when={hasContent()} fallback={<text fg={theme.text}>No usage data available.</text>}>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={scrollHeight()}
          scrollAcceleration={scrollAcceleration()}
        >
          <For each={props.results}>
            {(result, index) => {
              const hasSnapshot = hasUsageSnapshot(result)
              const planType = hasSnapshot ? formatPlanType(result.snapshot.planType) : null
              return (
                <box flexDirection="column" marginTop={index() === 0 ? 0 : 1} gap={1}>
                  <box flexDirection="column">
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      {result.displayName} Usage
                      <Show when={planType}>
                        <span style={{ fg: theme.textMuted }}>{` (${planType})`}</span>
                      </Show>
                    </text>
                    <text fg={theme.textMuted}>{"─".repeat(Math.max(24, result.displayName.length + 20))}</text>
                  </box>
                  <Show when={hasSnapshot}>
                    <For each={hasSnapshot ? result.snapshot.windows : []}>
                      {(window) => <box flexDirection="column">{renderWindow(window, mode(), theme)}</box>}
                    </For>
                    <Show when={hasSnapshot ? result.snapshot.credits : null}>
                      {(credits) => <text fg={theme.text}>{formatCreditsLabel(credits(), { mode: mode() })}</text>}
                    </Show>
                  </Show>
                  <Show when={result.error}>
                    <text fg={theme.error} attributes={TextAttributes.DIM}>
                      {result.error!.message}
                    </text>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

function renderWindow(window: UsageWindow, mode: UsageDisplayMode, theme: Theme, showReset = true) {
  const usedPercent = usageDisplay(window.usedPercent, "used").percent
  const display = usageDisplay(window.usedPercent, mode)
  const windowLabel = formatUsageWindowLabel(window.label, window.windowMinutes)

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        {windowLabel} Limit: [
        <span style={{ fg: usageBarColor(usedPercent, theme) }}>{usageBarString(display.percent)}</span>]{" "}
        {display.percent.toFixed(0)}% {display.label}
      </text>
      <Show when={showReset && window.resetsAt !== null}>
        <text fg={theme.textMuted}>Resets {formatUsageResetAbsolute(window.resetsAt!)}</text>
      </Show>
    </box>
  )
}
