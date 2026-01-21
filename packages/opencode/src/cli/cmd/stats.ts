import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Instance } from "../../project/instance"

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
  modelUsage: Record<
    string,
    {
      messages: number
      tokens: {
        input: number
        output: number
      }
      cost: number
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
  tokensPerSession: number
  medianTokensPerSession: number
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const stats = await aggregateSessionStats(args.days, args.project)

      let modelLimit: number | undefined
      if (args.models === true) {
        modelLimit = Infinity
      } else if (typeof args.models === "number") {
        modelLimit = args.models
      }

      displayStats(stats, args.tools, modelLimit)
    })
  },
})

async function getCurrentProject(): Promise<Project.Info> {
  return Instance.project
}

async function getAllSessions(): Promise<Session.Info[]> {
  const sessions: Session.Info[] = []

  const projectKeys = await Storage.list(["project"])
  const projects = await Promise.all(projectKeys.map((key) => Storage.read<Project.Info>(key)))

  for (const project of projects) {
    if (!project) continue

    const sessionKeys = await Storage.list(["session", project.id])
    const projectSessions = await Promise.all(sessionKeys.map((key) => Storage.read<Session.Info>(key)))

    for (const session of projectSessions) {
      if (session) {
        sessions.push(session)
      }
    }
  }

  return sessions
}

export async function aggregateSessionStats(days?: number, projectFilter?: string): Promise<SessionStats> {
  const sessions = await getAllSessions()
  const MS_IN_DAY = 24 * 60 * 60 * 1000

  const cutoffTime = (() => {
    if (days === undefined) return 0
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    return Date.now() - days * MS_IN_DAY
  })()

  const windowDays = (() => {
    if (days === undefined) return
    if (days === 0) return 1
    return days
  })()

  let filteredSessions = cutoffTime > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  if (projectFilter !== undefined) {
    if (projectFilter === "") {
      const currentProject = await getCurrentProject()
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    } else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  const stats: SessionStats = {
    totalSessions: filteredSessions.length,
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
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  if (filteredSessions.length > 1000) {
    console.log(`Large dataset detected (${filteredSessions.length} sessions). This may take a while...`)
  }

  if (filteredSessions.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  let earliestTime = Date.now()
  let latestTime = 0

  const sessionTotalTokens: number[] = []

  const BATCH_SIZE = 20
  for (let i = 0; i < filteredSessions.length; i += BATCH_SIZE) {
    const batch = filteredSessions.slice(i, i + BATCH_SIZE)

    const batchPromises = batch.map(async (session) => {
      const messages = await Session.messages({ sessionID: session.id })

      let sessionCost = 0
      let sessionTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      let sessionToolUsage: Record<string, number> = {}
      let sessionModelUsage: Record<
        string,
        {
          messages: number
          tokens: {
            input: number
            output: number
          }
          cost: number
        }
      > = {}

      for (const message of messages) {
        if (message.info.role === "assistant") {
          sessionCost += message.info.cost || 0

          const modelKey = `${message.info.providerID}/${message.info.modelID}`
          if (!sessionModelUsage[modelKey]) {
            sessionModelUsage[modelKey] = {
              messages: 0,
              tokens: { input: 0, output: 0 },
              cost: 0,
            }
          }
          sessionModelUsage[modelKey].messages++
          sessionModelUsage[modelKey].cost += message.info.cost || 0

          if (message.info.tokens) {
            sessionTokens.input += message.info.tokens.input || 0
            sessionTokens.output += message.info.tokens.output || 0
            sessionTokens.reasoning += message.info.tokens.reasoning || 0
            sessionTokens.cache.read += message.info.tokens.cache?.read || 0
            sessionTokens.cache.write += message.info.tokens.cache?.write || 0

            sessionModelUsage[modelKey].tokens.input += message.info.tokens.input || 0
            sessionModelUsage[modelKey].tokens.output +=
              (message.info.tokens.output || 0) + (message.info.tokens.reasoning || 0)
          }
        }

        for (const part of message.parts) {
          if (part.type === "tool" && part.tool) {
            sessionToolUsage[part.tool] = (sessionToolUsage[part.tool] || 0) + 1
          }
        }
      }

      return {
        messageCount: messages.length,
        sessionCost,
        sessionTokens,
        sessionTotalTokens: sessionTokens.input + sessionTokens.output + sessionTokens.reasoning,
        sessionToolUsage,
        sessionModelUsage,
        earliestTime: cutoffTime > 0 ? session.time.updated : session.time.created,
        latestTime: session.time.updated,
      }
    })

    const batchResults = await Promise.all(batchPromises)

    for (const result of batchResults) {
      earliestTime = Math.min(earliestTime, result.earliestTime)
      latestTime = Math.max(latestTime, result.latestTime)
      sessionTotalTokens.push(result.sessionTotalTokens)

      stats.totalMessages += result.messageCount
      stats.totalCost += result.sessionCost
      stats.totalTokens.input += result.sessionTokens.input
      stats.totalTokens.output += result.sessionTokens.output
      stats.totalTokens.reasoning += result.sessionTokens.reasoning
      stats.totalTokens.cache.read += result.sessionTokens.cache.read
      stats.totalTokens.cache.write += result.sessionTokens.cache.write

      for (const [tool, count] of Object.entries(result.sessionToolUsage)) {
        stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count
      }

      for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
        if (!stats.modelUsage[model]) {
          stats.modelUsage[model] = {
            messages: 0,
            tokens: { input: 0, output: 0 },
            cost: 0,
          }
        }
        stats.modelUsage[model].messages += usage.messages
        stats.modelUsage[model].tokens.input += usage.tokens.input
        stats.modelUsage[model].tokens.output += usage.tokens.output
        stats.modelUsage[model].cost += usage.cost
      }
    }
  }

  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays
  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays
  const totalTokens = stats.totalTokens.input + stats.totalTokens.output + stats.totalTokens.reasoning
  stats.tokensPerSession = filteredSessions.length > 0 ? totalTokens / filteredSessions.length : 0
  sessionTotalTokens.sort((a, b) => a - b)
  const mid = Math.floor(sessionTotalTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTotalTokens.length === 0
      ? 0
      : sessionTotalTokens.length % 2 === 0
        ? (sessionTotalTokens[mid - 1] + sessionTotalTokens[mid]) / 2
        : sessionTotalTokens[mid]

  return stats
}

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number) {
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
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Model Usage section
  if (modelLimit !== undefined && Object.keys(stats.modelUsage).length > 0) {
    const sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
    const modelsToDisplay = modelLimit === Infinity ? sortedModels : sortedModels.slice(0, modelLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      MODEL USAGE                       │")
    console.log("├────────────────────────────────────────────────────────┤")

    for (const [model, usage] of modelsToDisplay) {
      console.log(`│ ${model.padEnd(54)} │`)
      console.log(renderRow("  Messages", usage.messages.toLocaleString()))
      console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
      console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
      console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))
      console.log("├────────────────────────────────────────────────────────┤")
    }
    // Remove last separator and add bottom border
    process.stdout.write("\x1B[1A") // Move up one line
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  // Tool Usage section
  if (Object.keys(stats.toolUsage).length > 0) {
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
    const toolsToDisplay = toolLimit ? sortedTools.slice(0, toolLimit) : sortedTools

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(...toolsToDisplay.map(([, count]) => count))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

    for (const [tool, count] of toolsToDisplay) {
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
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
