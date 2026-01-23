import { Session } from "../session"
import { Storage } from "../storage/storage"
import type { Project } from "../project/project"

export namespace StatsAggregator {
  export interface DailyStats {
    date: string // YYYY-MM-DD format
    tokens: {
      input: number
      output: number
      reasoning: number
      total: number
    }
    sessions: number
    messages: number
    cost: number
  }

  export interface ModelUsage {
    messages: number
    tokens: {
      input: number
      output: number
    }
    cost: number
  }

  export interface AggregatedStats {
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
    modelUsage: Record<string, ModelUsage>
    dateRange: {
      earliest: number
      latest: number
    }
    days: number
    costPerDay: number
    tokensPerSession: number
    medianTokensPerSession: number
    // NEW: Daily breakdown for heatmap
    dailyStats: DailyStats[]
  }

  export interface AggregateOptions {
    days?: number
    projectFilter?: string // project ID to filter by, undefined = all projects
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

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp)
    return date.toISOString().split("T")[0]
  }

  export async function aggregate(options: AggregateOptions = {}): Promise<AggregatedStats> {
    const { days, projectFilter } = options
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
      if (days === undefined) return undefined
      if (days === 0) return 1
      return days
    })()

    let filteredSessions = cutoffTime > 0 
      ? sessions.filter((session) => session.time.updated >= cutoffTime) 
      : sessions

    if (projectFilter !== undefined) {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }

    // Initialize daily stats map
    const dailyStatsMap: Map<string, DailyStats> = new Map()

    const stats: AggregatedStats = {
      totalSessions: filteredSessions.length,
      totalMessages: 0,
      totalCost: 0,
      totalTokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      toolUsage: {},
      modelUsage: {},
      dateRange: { earliest: Date.now(), latest: Date.now() },
      days: 0,
      costPerDay: 0,
      tokensPerSession: 0,
      medianTokensPerSession: 0,
      dailyStats: [],
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
        let sessionModelUsage: Record<string, ModelUsage> = {}
        
        // Track daily stats for this session
        const sessionDate = formatDate(session.time.updated)

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
          sessionDate,
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

        // Aggregate daily stats
        const dateKey = result.sessionDate
        if (!dailyStatsMap.has(dateKey)) {
          dailyStatsMap.set(dateKey, {
            date: dateKey,
            tokens: { input: 0, output: 0, reasoning: 0, total: 0 },
            sessions: 0,
            messages: 0,
            cost: 0,
          })
        }
        const daily = dailyStatsMap.get(dateKey)!
        daily.tokens.input += result.sessionTokens.input
        daily.tokens.output += result.sessionTokens.output
        daily.tokens.reasoning += result.sessionTokens.reasoning
        daily.tokens.total += result.sessionTotalTokens
        daily.sessions += 1
        daily.messages += result.messageCount
        daily.cost += result.sessionCost

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
    stats.dateRange = { earliest: earliestTime, latest: latestTime }
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

    // Convert daily stats map to sorted array
    stats.dailyStats = Array.from(dailyStatsMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    return stats
  }

  export function formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    return num.toString()
  }
}
