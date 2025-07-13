import { Storage } from "../../storage/storage"
import { MessageV2 } from "../../session/message-v2"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"

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
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "analyze and display statistics from message-v2 format",
  handler: async () => {
    await bootstrap({ cwd: process.cwd() }, async () => {
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
        toolUsage: {},
        dateRange: {
          earliest: Date.now(),
          latest: 0,
        },
        days: 0,
        costPerDay: 0,
      }

      const sessionMap = new Map<string, number>()

      try {
        for await (const messagePath of Storage.list("session/message")) {
          try {
            const message = await Storage.readJSON<MessageV2.Info>(messagePath)
            if (!message.parts.find((part) => part.type === "step-finish")) continue

            stats.totalMessages++

            const sessionId = message.sessionID
            sessionMap.set(sessionId, (sessionMap.get(sessionId) || 0) + 1)

            if (message.time.created < stats.dateRange.earliest) {
              stats.dateRange.earliest = message.time.created
            }
            if (message.time.created > stats.dateRange.latest) {
              stats.dateRange.latest = message.time.created
            }

            if (message.role === "assistant") {
              stats.totalCost += message.cost
              stats.totalTokens.input += message.tokens.input
              stats.totalTokens.output += message.tokens.output
              stats.totalTokens.reasoning += message.tokens.reasoning
              stats.totalTokens.cache.read += message.tokens.cache.read
              stats.totalTokens.cache.write += message.tokens.cache.write

              for (const part of message.parts) {
                if (part.type === "tool") {
                  stats.toolUsage[part.tool] = (stats.toolUsage[part.tool] || 0) + 1
                }
              }
            }
          } catch (e) {
            continue
          }
        }
      } catch (e) {
        console.error("Failed to read storage:", e)
        return
      }

      stats.totalSessions = sessionMap.size

      if (stats.dateRange.latest > 0) {
        const daysDiff = (stats.dateRange.latest - stats.dateRange.earliest) / (1000 * 60 * 60 * 24)
        stats.days = Math.max(1, Math.ceil(daysDiff))
        stats.costPerDay = stats.totalCost / stats.days
      }

      displayStats(stats)
    })
  },
})

function displayStats(stats: SessionStats) {
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
}
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}
