import type { SessionStatsInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { activityCalendar } from "@opencode-ai/util/activity-calendar"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Logo } from "../../component/logo"
import { useTheme, useThemes } from "../../context/theme"
import { tint } from "../../theme/color"
import { statsMetrics, statsNumber } from "./stats-data"

const digits: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ".": ["0", "0", "0", "0", "1"],
  K: ["101", "110", "100", "110", "101"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  B: ["110", "101", "110", "101", "110"],
  T: ["111", "010", "010", "010", "010"],
}

export function StatsPoster(props: { stats: SessionStatsInfo }) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const themes = useThemes()
  const width = () => Math.max(12, Math.min(110, dimensions().width - 8))
  const compact = () => dimensions().height < 38
  const metrics = createMemo(() => statsMetrics(props.stats))
  const number = () => statsNumber(metrics()[0].value)
  const dates = createMemo(() =>
    new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).formatRange(
      new Date(props.stats.range.from),
      new Date(Math.max(props.stats.range.from, props.stats.range.to - 1)),
    ),
  )
  const letters = createMemo(() => Array.from(number()).map((char) => digits[char]))
  const large = () =>
    letters().every(Boolean) && letters().reduce((sum, char) => sum + char[0].length * 2 + 2, -2) <= width()
  const calendar = createMemo(() =>
    activityCalendar({
      activity: props.stats.activity,
      from: props.stats.range.from,
      to: props.stats.range.to,
      maxWeeks: Math.floor((width() - 4) / 2),
    }),
  )
  const shades = createMemo(() => [
    theme.text.subdued,
    ...[0.3, 0.5, 0.75, 1].map((alpha) =>
      tint(theme.background.default, theme.categorical[0][themes.mode() === "light" ? 800 : 200], alpha),
    ),
  ])

  return (
    <box width={width()} flexDirection="column" alignItems="center" flexShrink={0} gap={compact() ? 1 : 2}>
      <box width="100%" flexDirection={width() < 44 ? "column" : "row"} justifyContent="space-between">
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
          opencode / stats
        </text>
        <text fg={theme.text.subdued}>{dates()}</text>
      </box>
      <Show when={!compact()}>
        <Logo />
      </Show>
      <box alignItems="center" gap={1}>
        <Show
          when={large()}
          fallback={
            <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
              {number()}
            </text>
          }
        >
          <box>
            <For each={[0, 1, 2, 3, 4]}>
              {(row) => (
                <text fg={theme.text.default} selectable={false}>
                  {letters()
                    .map((char) => char[row].replaceAll("1", "\u2588\u2588").replaceAll("0", "  "))
                    .join("  ")}
                </text>
              )}
            </For>
          </box>
        </Show>
        <text fg={theme.text.subdued}>TOKENS</text>
      </box>
      <box alignItems="center">
        <text fg={theme.text.subdued}>
          {"    " +
            calendar()
              .months.map((month) => (month.label.length <= month.span * 2 ? month.label : "").padEnd(month.span * 2))
              .join("")}
        </text>
        <For each={["M", "T", "W", "T", "F", "S", "S"]}>
          {(day, index) => (
            <box flexDirection="row" height={1}>
              <text fg={theme.text.subdued}>{day + "   "}</text>
              <For each={calendar().weeks}>
                {(week) => (
                  <text fg={shades()[Math.max(0, week[index()].level)]} selectable={false}>
                    {week[index()].level < 0 ? "  " : week[index()].level === 0 ? "\u00b7 " : "\u25a0 "}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
        <Show when={calendar().clipped}>
          <text fg={theme.text.subdued}>Your last {calendar().weeks.length} weeks</text>
        </Show>
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-around">
        <For each={metrics().slice(1)}>
          {(metric) => (
            <box alignItems="center">
              <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
                {statsNumber(metric.value)}
                {metric.label === "best streak" ? " days" : ""}
              </text>
              <text fg={theme.text.subdued}>{metric.label}</text>
            </box>
          )}
        </For>
      </box>
      <box width="100%" flexDirection="row" justifyContent="flex-end">
        <text fg={theme.text.default}>opencode.ai</text>
      </box>
    </box>
  )
}

function StatsPage(props: { context: Plugin.Context; onClose: () => void }) {
  const [result] = createResource(() => {
    const now = new Date()
    return props.context.client.session.stats({
      from: new Date(now.getFullYear(), 0, 1).getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      tools: "none",
    })
  })
  const theme = useTheme()

  props.context.keymap.layer(() => ({
    commands: [{ bind: "escape", title: "back", run: props.onClose }],
  }))

  return (
    <box width="100%" height="100%" backgroundColor={theme.background.default}>
      <scrollbox
        flexGrow={1}
        contentOptions={{
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100%",
          paddingTop: 1,
          paddingBottom: 1,
        }}
      >
        <Show
          when={!result.error}
          fallback={
            <text fg={theme.text.feedback.error.default}>Could not load stats. Reopen /stats to try again.</text>
          }
        >
          <Show when={result()} fallback={<text fg={theme.text.subdued}>Gathering your stats…</text>}>
            {(value) => <StatsPoster stats={value()} />}
          </Show>
        </Show>
      </scrollbox>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.stats",
  setup(context) {
    const [previous, setPrevious] = createSignal({ ...context.ui.router.current() })
    context.ui.router.register({
      name: "stats",
      render: () => <StatsPage context={context} onClose={() => context.ui.router.navigate(previous())} />,
    })
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "stats.open",
              title: "Usage statistics",
              group: "System",
              slash: { name: "stats" },
              palette: true,
              run() {
                const current = context.ui.router.current()
                if (current.type === "plugin" && current.name === "stats") return
                // The router exposes a mutable store; retain the route before navigating.
                setPrevious({ ...current })
                context.ui.dialog.clear()
                context.ui.router.navigate({ type: "plugin", name: "stats" })
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
