import { cmd } from "./cmd"
import { ToolHistory } from "../../tool/history"

interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  toolUsage: Record<string, number>
  toolTelemetry: Record<
    string,
    {
      runs: number
      errors: number
      totalDuration: number
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
}

export const StatsCommand = cmd({
  command: "stats",
  handler: async () => {
    const history = await ToolHistory.read()
    const toolUsage = Object.fromEntries(
      Object.entries(history.tools).map(([tool, data]) => [tool, data.runs]),
    )
    const timestamps = history.events.map((event) => event.timestamp)
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : Date.now()
    const latest = timestamps.length > 0 ? Math.max(...timestamps) : earliest
    const days = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)))

    const stats: SessionStats = {
      totalSessions: 0,
      totalMessages: 0,
      totalCost: 0,
      totalTokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      toolUsage,
      toolTelemetry: history.tools,
      dateRange: { earliest, latest },
      days,
      costPerDay: 0,
    }
    displayStats(stats)
  },
})

export function displayStats(stats: SessionStats) {
  const width = 56

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Overview section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Cost & Tokens section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                    COST & TOKENS                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Tool Usage section
  if (Object.keys(stats.toolUsage).length > 0) {
    const sortedTools = Object.entries(stats.toolUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(...sortedTools.map(([, count]) => count))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

    for (const [tool, count] of sortedTools) {
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      const content = ` ${tool.padEnd(10)} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  if (Object.keys(stats.toolTelemetry ?? {}).length > 0) {
    console.log("┌─────────────────────── TOOL TELEMETRY ─────────────────────┐")
    console.log("│ Tool        Runs   Avg     Errors                         │")
    console.log("├───────────────────────────────────────────────────────────┤")
    for (const [tool, data] of Object.entries(stats.toolTelemetry)) {
      const avg = data.runs > 0 ? data.totalDuration / data.runs : 0
      const avgLabel = avg < 1000 ? `${avg.toFixed(0)}ms` : `${(avg / 1000).toFixed(2)}s`
      const line = `│ ${tool.padEnd(10)} ${String(data.runs).padStart(4)} ${avgLabel.padEnd(7)} ${
        String(data.errors).padStart(5)
      } errors                   │`
      console.log(line)
    }
    console.log("└───────────────────────────────────────────────────────────┘")
    console.log()
  }
}
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}
