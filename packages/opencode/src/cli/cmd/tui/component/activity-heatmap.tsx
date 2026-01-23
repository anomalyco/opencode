import { For, createMemo, Show } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import type { StatsAggregator } from "@/stats/aggregator"

export type HeatmapViewMode = "7d" | "30d" | "1y"

export interface ActivityHeatmapProps {
  dailyStats: StatsAggregator.DailyStats[]
  viewMode: HeatmapViewMode
}

// Get all dates for the heatmap grid
function generateDateGrid(viewMode: HeatmapViewMode): string[][] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  let totalDays: number
  switch (viewMode) {
    case "7d":
      totalDays = 7
      break
    case "30d":
      totalDays = 30
      break
    case "1y":
      totalDays = 365
      break
  }

  // Find the start date (align to Sunday for week start)
  const endDate = new Date(today)
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - totalDays + 1)
  
  // For 30d and 1y views, align to start of week (Sunday)
  if (viewMode !== "7d") {
    const dayOfWeek = startDate.getDay()
    startDate.setDate(startDate.getDate() - dayOfWeek)
  }

  // Generate grid: 7 rows (days of week) x N columns (weeks)
  const weeks: string[][] = []
  const current = new Date(startDate)
  
  while (current <= endDate) {
    const week: string[] = []
    for (let day = 0; day < 7; day++) {
      if (current <= endDate && current >= startDate) {
        week.push(current.toISOString().split("T")[0])
      } else {
        week.push("") // Empty cell for padding
      }
      current.setDate(current.getDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

// Get intensity level (0-4) based on token count
function getIntensityLevel(tokens: number, maxTokens: number): number {
  if (tokens === 0 || maxTokens === 0) return 0
  const ratio = tokens / maxTokens
  if (ratio < 0.25) return 1
  if (ratio < 0.50) return 2
  if (ratio < 0.75) return 3
  return 4
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function ActivityHeatmap(props: ActivityHeatmapProps) {
  const { theme } = useTheme()

  // Create a map for quick lookup
  const statsMap = createMemo(() => {
    const map = new Map<string, number>()
    for (const stat of props.dailyStats) {
      map.set(stat.date, stat.tokens.total)
    }
    return map
  })

  // Find max tokens for intensity calculation
  const maxTokens = createMemo(() => {
    return Math.max(...props.dailyStats.map(s => s.tokens.total), 1)
  })

  // Generate the date grid
  const grid = createMemo(() => generateDateGrid(props.viewMode))

  // Get color based on intensity
  const getColor = (level: number) => {
    switch (level) {
      case 0: return theme.borderSubtle
      case 1: return tint(theme.background, theme.primary, 0.25)
      case 2: return tint(theme.background, theme.primary, 0.5)
      case 3: return tint(theme.background, theme.primary, 0.75)
      case 4: return theme.primary
      default: return theme.borderSubtle
    }
  }

  // Get month labels for the grid
  const monthLabels = createMemo(() => {
    const labels: { month: string; position: number }[] = []
    const weeks = grid()
    let lastMonth = -1
    
    for (let weekIdx = 0; weekIdx < weeks.length; weekIdx++) {
      const week = weeks[weekIdx]
      // Check first non-empty date in week
      for (const dateStr of week) {
        if (dateStr) {
          const month = new Date(dateStr).getMonth()
          if (month !== lastMonth) {
            labels.push({ month: MONTH_LABELS[month], position: weekIdx })
            lastMonth = month
          }
          break
        }
      }
    }
    return labels
  })

  // Cell character based on view mode
  const cellChar = () => props.viewMode === "1y" ? "▪" : "█"

  return (
    <box flexDirection="column" gap={0}>
      {/* Month labels row (only for 30d and 1y views) */}
      <Show when={props.viewMode !== "7d"}>
        <box flexDirection="row" paddingLeft={4}>
          <For each={monthLabels()}>
            {(label, idx) => {
              const nextPos = monthLabels()[idx() + 1]?.position ?? grid().length
              const width = nextPos - label.position
              return (
                <text 
                  fg={theme.textMuted} 
                  width={width * (props.viewMode === "1y" ? 1 : 2)}
                >
                  {label.month}
                </text>
              )
            }}
          </For>
        </box>
      </Show>

      {/* Grid with day labels */}
      <box flexDirection="column">
        <For each={[0, 1, 2, 3, 4, 5, 6]}>
          {(dayIdx) => (
            <box flexDirection="row" gap={0}>
              {/* Day label */}
              <text fg={theme.textMuted} width={4}>
                {dayIdx % 2 === 1 ? DAY_LABELS[dayIdx].substring(0, 3) : "   "}
              </text>
              
              {/* Cells for this day across all weeks */}
              <For each={grid()}>
                {(week) => {
                  const dateStr = week[dayIdx] || ""
                  const tokens = dateStr ? (statsMap().get(dateStr) || 0) : 0
                  const level = getIntensityLevel(tokens, maxTokens())
                  const color = getColor(level)
                  
                  return (
                    <text 
                      fg={dateStr ? color : theme.background}
                      width={props.viewMode === "1y" ? 1 : 2}
                    >
                      {dateStr ? cellChar() : " "}
                    </text>
                  )
                }}
              </For>
            </box>
          )}
        </For>
      </box>

      {/* Legend */}
      <box flexDirection="row" gap={1} paddingTop={1} paddingLeft={4}>
        <text fg={theme.textMuted}>Less</text>
        <For each={[0, 1, 2, 3, 4]}>
          {(level) => (
            <text fg={getColor(level)}>{cellChar()}</text>
          )}
        </For>
        <text fg={theme.textMuted}>More</text>
      </box>
    </box>
  )
}
