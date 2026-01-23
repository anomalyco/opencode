import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, onMount, createMemo } from "solid-js"
import { StatsAggregator } from "@/stats/aggregator"
import { ActivityHeatmap, type HeatmapViewMode } from "./activity-heatmap"
import { useDialog } from "@tui/ui/dialog"
import "opentui-spinner/solid"

export function DialogStats() {
  const { theme } = useTheme()
  const dialog = useDialog()
  
  const [viewMode, setViewMode] = createSignal<HeatmapViewMode>("30d")
  const [loading, setLoading] = createSignal(true)
  const [stats7, setStats7] = createSignal<StatsAggregator.AggregatedStats | null>(null)
  const [stats30, setStats30] = createSignal<StatsAggregator.AggregatedStats | null>(null)
  const [stats365, setStats365] = createSignal<StatsAggregator.AggregatedStats | null>(null)

  // Load stats
  const loadStats = async () => {
    setLoading(true)
    try {
      const [s7, s30, s365] = await Promise.all([
        StatsAggregator.aggregate({ days: 7 }),
        StatsAggregator.aggregate({ days: 30 }),
        StatsAggregator.aggregate({ days: 365 }),
      ])
      
      setStats7(s7)
      setStats30(s30)
      setStats365(s365)
    } catch (e) {
      // Stats loading failed - show empty state
      console.error("Failed to load stats:", e)
    }
    setLoading(false)
  }

  onMount(loadStats)

  // Get current stats based on view mode
  const currentStats = createMemo(() => {
    switch (viewMode()) {
      case "7d": return stats7()
      case "30d": return stats30()
      case "1y": return stats365()
    }
  })

  // Keyboard handling
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
    }
    // Shift+R to cycle view modes
    if (evt.shift && evt.name === "r") {
      setViewMode((current) => {
        switch (current) {
          case "7d": return "30d"
          case "30d": return "1y"
          case "1y": return "7d"
        }
      })
    }
  })

  const formatNumber = StatsAggregator.formatNumber

  // Model usage sorted by total tokens
  const sortedModels = createMemo(() => {
    const s = stats30()
    if (!s) return []
    return Object.entries(s.modelUsage)
      .sort(([, a], [, b]) => (b.tokens.input + b.tokens.output) - (a.tokens.input + a.tokens.output))
      .slice(0, 5) // Top 5 models
  })

  const totalModelTokens = createMemo(() => {
    return sortedModels().reduce((sum, [, usage]) => sum + usage.tokens.input + usage.tokens.output, 0)
  })

  return (
    <box 
      flexDirection="column" 
      paddingLeft={2} 
      paddingRight={2} 
      paddingBottom={1}
      gap={1}
    >
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Token Usage Statistics
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>
            {viewMode() === "7d" ? "7 Days" : viewMode() === "30d" ? "30 Days" : "1 Year"}
          </text>
          <text fg={theme.textMuted}>shift+r: view</text>
          <text fg={theme.textMuted}>esc: close</text>
        </box>
      </box>

      <Show when={!loading()} fallback={
        <box flexDirection="row" justifyContent="center" padding={2}>
          <spinner frames={["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]} interval={80} color={theme.primary} />
          <text fg={theme.textMuted}> Loading statistics...</text>
        </box>
      }>
        {/* Activity Heatmap */}
        <box flexDirection="column">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Activity ({viewMode() === "7d" ? "Last 7 Days" : viewMode() === "30d" ? "Last 30 Days" : "Last Year"})
          </text>
          <Show when={currentStats()}>
            {(s) => (
              <ActivityHeatmap 
                dailyStats={s().dailyStats} 
                viewMode={viewMode()}
              />
            )}
          </Show>
        </box>

        {/* Summary Cards - Side by Side */}
        <box flexDirection="row" gap={2}>
          {/* 7 Day Summary */}
          <box flexDirection="column" flexGrow={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              7 Days
            </text>
            <Show when={stats7()}>
              {(s) => (
                <box flexDirection="column">
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Input:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.input)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Output:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.output)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Cache:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.cache.read + s().totalTokens.cache.write)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Sessions:</text>
                    <text fg={theme.text}>{s().totalSessions}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Cost:</text>
                    <text fg={theme.success}>${s().totalCost.toFixed(2)}</text>
                  </box>
                </box>
              )}
            </Show>
          </box>

          {/* 30 Day Summary */}
          <box flexDirection="column" flexGrow={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              30 Days
            </text>
            <Show when={stats30()}>
              {(s) => (
                <box flexDirection="column">
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Input:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.input)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Output:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.output)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Cache:</text>
                    <text fg={theme.text}>{formatNumber(s().totalTokens.cache.read + s().totalTokens.cache.write)}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Sessions:</text>
                    <text fg={theme.text}>{s().totalSessions}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>Cost:</text>
                    <text fg={theme.success}>${s().totalCost.toFixed(2)}</text>
                  </box>
                </box>
              )}
            </Show>
          </box>
        </box>

        {/* Model Usage */}
        <Show when={sortedModels().length > 0}>
          <box flexDirection="column">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Model Usage (30 Days)
            </text>
            <For each={sortedModels()}>
              {([model, usage]) => {
                const tokens = usage.tokens.input + usage.tokens.output
                const percentage = totalModelTokens() > 0 ? (tokens / totalModelTokens()) * 100 : 0
                const barLength = Math.max(1, Math.floor(percentage / 5)) // 20 char max bar
                
                return (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text} width={30}>
                      {model.length > 28 ? model.substring(0, 26) + ".." : model}
                    </text>
                    <text fg={theme.primary}>
                      {"█".repeat(barLength)}{"░".repeat(20 - barLength)}
                    </text>
                    <text fg={theme.textMuted} width={6}>
                      {percentage.toFixed(0)}%
                    </text>
                    <text fg={theme.text}>
                      {formatNumber(tokens)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        {/* Footer */}
        <box flexDirection="row" justifyContent="flex-end">
          <text fg={theme.textMuted}>All Projects</text>
        </box>
      </Show>
    </box>
  )
}
