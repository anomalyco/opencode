import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useTuiConfig } from "../../config"
import { useUsageResource } from "../../component/usage-client"
import { hasUsageSnapshot } from "../../component/usage-data"
import {
  formatCreditsLabel,
  formatPlanType,
  formatUsageResetShort,
  formatUsageWindowLabel,
  usageBarColor,
  usageBarString,
  usageDisplay,
} from "../../component/usage-format"

const id = "internal:sidebar-usage"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const tuiConfig = useTuiConfig()
  const usage = useUsageResource()
  const theme = () => props.api.theme.current

  const entries = createMemo(() => {
    return (usage.data()?.results ?? [])
      .filter(hasUsageSnapshot)
      .filter((entry) => entry.snapshot.windows.length > 0 || entry.snapshot.credits)
  })
  const mode = createMemo(() => tuiConfig.show_usage_value_mode ?? "used")

  return (
    <Show when={entries().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          <text fg={theme().text}>
            <b>Usage</b>
            <Show when={mode() === "remaining"}>
              <span style={{ fg: theme().textMuted }}> (remaining)</span>
            </Show>
          </text>
        </box>
        <Show when={open()}>
          <For each={entries()}>
            {(entry, index) => {
              const planType = formatPlanType(entry.snapshot.planType)
              return (
                <box flexDirection="column" gap={0} marginTop={index() === 0 ? 0 : 1}>
                  <text fg={theme().text}>
                    <b>{entry.displayName}</b>
                    <Show when={planType}>
                      <span style={{ fg: theme().textMuted }}>{` (${planType})`}</span>
                    </Show>
                  </text>
                  <For each={entry.snapshot.windows}>
                    {(window) => {
                      const usedPercent = usageDisplay(window.usedPercent, "used").percent
                      const displayPercent = usageDisplay(window.usedPercent, mode()).percent
                      return (
                        <text fg={theme().textMuted}>
                          {formatUsageWindowLabel(window.label, window.windowMinutes)}{" "}
                          <span style={{ fg: usageBarColor(usedPercent, theme()) }}>
                            {usageBarString(displayPercent, 10)}
                          </span>{" "}
                          {Math.round(displayPercent)}%{" "}
                          <Show when={window.resetsAt !== null}>({formatUsageResetShort(window.resetsAt)})</Show>
                        </text>
                      )
                    }}
                  </For>
                  <Show when={entry.snapshot.credits}>
                    {(credits) => <text fg={theme().textMuted}>{formatCreditsLabel(credits(), { mode: mode() })}</text>}
                  </Show>
                  <Show when={entry.error}>
                    <text fg={theme().error}>{entry.error!.message}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, _props) {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
