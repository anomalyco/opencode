import { cmd } from "./cmd"
import { ToolHistory } from "../../tool/history"
import type { TelemetryEvent } from "../../tool/telemetry-event"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"

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

type StatsArgs = {
  json?: boolean
  telemetry?: string
  limit?: number
  clear?: boolean
}

export const StatsCommand = cmd<StatsArgs, StatsArgs>({
  command: "stats",
  describe: "Show session and telemetry statistics",
  builder: (yargs) =>
    yargs
      .option("json", {
        describe: "Output raw JSON instead of formatted tables",
        type: "boolean",
        default: false,
      })
      .option("telemetry", {
        describe: "Filter telemetry events by tool id (use 'all' for everything)",
        type: "string",
      })
      .option("limit", {
        describe: "Number of telemetry events to display",
        type: "number",
        default: 20,
      })
      .option("clear", {
        describe: "Clear stored telemetry history before printing stats",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (args.clear) {
        await ToolHistory.clear()
        console.log("Cleared telemetry history.")
      }
      const history = await ToolHistory.read()
      const toolUsage = Object.fromEntries(
        Object.entries(history.tools).map(([tool, data]) => [tool, data.runs]),
      )
      const telemetryFilter = args.telemetry?.trim()
      const telemetryEvents = (() => {
        if (!telemetryFilter) return history.events
        if (telemetryFilter === "all") return history.events
        return history.events.filter((event) => event.id === telemetryFilter)
      })()
      const limit = Math.max(1, args.limit ?? 20)
      const limitedTelemetry = telemetryEvents.slice(-limit)

      const sessionMetrics = await aggregateSessions()
      const stats: SessionStats = {
        ...sessionMetrics,
        toolUsage,
        toolTelemetry: history.tools,
      }

      if (args.json) {
        const json = {
          stats,
          telemetry: limitedTelemetry,
        }
        console.log(JSON.stringify(json, null, 2))
        return
      }

      displayStats(stats)
      if (telemetryFilter) displayTelemetryEvents(limitedTelemetry)
    })
  },
})

async function aggregateSessions(): Promise<Omit<SessionStats, "toolUsage" | "toolTelemetry">> {
  const sessions: Session.Info[] = []
  for await (const info of Session.list()) {
    sessions.push(info)
  }

  let totalMessages = 0
  let totalCost = 0
  let inputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0

  let earliest = sessions.length > 0 ? Math.min(...sessions.map((s) => s.time.created)) : Date.now()
  let latest = sessions.length > 0 ? Math.max(...sessions.map((s) => s.time.updated)) : earliest

  for (const session of sessions) {
    earliest = Math.min(earliest, session.time.created)
    latest = Math.max(latest, session.time.updated)
    const messages = await Session.messages(session.id)
    totalMessages += messages.length
    for (const message of messages) {
      if (message.info.role !== "assistant") continue
      const assistant = message.info as MessageV2.Assistant
      totalCost += assistant.cost ?? 0
      inputTokens += assistant.tokens?.input ?? 0
      outputTokens += assistant.tokens?.output ?? 0
      reasoningTokens += assistant.tokens?.reasoning ?? 0
      cacheReadTokens += assistant.tokens?.cache?.read ?? 0
      cacheWriteTokens += assistant.tokens?.cache?.write ?? 0
    }
  }

  const totalSessions = sessions.length
  const dayMillis = 1000 * 60 * 60 * 24
  const days = totalSessions > 0 ? Math.max(1, Math.ceil((latest - earliest) / dayMillis)) : 1
  const costPerDay = days > 0 ? totalCost / days : 0

  return {
    totalSessions,
    totalMessages,
    totalCost,
    totalTokens: {
      input: inputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
      cache: {
        read: cacheReadTokens,
        write: cacheWriteTokens,
      },
    },
    dateRange: { earliest, latest },
    days,
    costPerDay,
  }
}

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

function displayTelemetryEvents(events: TelemetryEvent[]) {
  if (events.length === 0) {
    console.log("No telemetry events match the provided filter.")
    return
  }
  console.log("┌──────────────────────── TELEMETRY EVENTS ───────────────────────┐")
  console.log("│ Time                 Tool        Status   Duration   Message     │")
  console.log("├─────────────────────────────────────────────────────────────────┤")
  for (const event of events) {
    const date = new Date(event.timestamp).toISOString().replace("T", " ").split(".")[0]
    const status = event.status === "success" ? "OK" : "ERR"
    const duration = event.duration < 1000 ? `${event.duration.toFixed(0)}ms` : `${(event.duration / 1000).toFixed(2)}s`
    const message = event.error ? event.error.slice(0, 24) : ""
    const line = `│ ${date} ${event.id.padEnd(10)} ${status.padEnd(7)} ${duration.padEnd(9)} ${message.padEnd(11)} │`
    console.log(line)
  }
  console.log("└─────────────────────────────────────────────────────────────────┘")
}
