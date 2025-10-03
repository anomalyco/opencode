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
  toolTelemetry: Record<string, ToolTelemetryStats>
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
}

type ToolTelemetryStats = {
  runs: number
  errors: number
  totalDuration: number
  averageDuration: number
  medianDuration: number
  p95Duration: number
  p99Duration: number
  errorRate: number
  successRate: number
}

type TelemetrySummary = {
  windowStart?: number
  windowEnd?: number
  totalRuns: number
  totalErrors: number
  perDayErrorRate?: number
  tools: Record<string, ToolTelemetryStats>
}

type DetailFormat = "pretty" | "ndjson" | "csv"

type ToolComparison = {
  tool: string
  baseline?: ToolTelemetryStats
  current?: ToolTelemetryStats
}

type TelemetryComparison = {
  path: string
  totalRunsDelta: number
  totalErrorsDelta: number
  toolComparisons: ToolComparison[]
}

type DetailOptions = {
  format: DetailFormat
  fields: string[]
}

type StatsArgs = {
  json?: boolean
  telemetry?: string
  limit?: number
  clear?: boolean
  details?: boolean
  detailsFormat?: DetailFormat
  fields?: string
  status?: string
  since?: string
  until?: string
  compare?: string
  warnLatency?: number
  warnErrors?: number
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
      })
      .option("details", {
        describe: "Print telemetry metadata for matching events",
        type: "boolean",
        default: false,
      })
      .option("details-format", {
        describe: "Format for telemetry metadata output (pretty, ndjson, csv)",
        type: "string",
        choices: ["pretty", "ndjson", "csv"],
        default: "pretty",
      })
      .option("fields", {
        describe: "Comma separated metadata keys to include in details",
        type: "string",
      })
      .option("status", {
        describe: "Filter telemetry events by status (success,error)",
        type: "string",
      })
      .option("since", {
        describe: "Only include telemetry events after this time (relative like 1d or ISO timestamp)",
        type: "string",
      })
      .option("until", {
        describe: "Only include telemetry events before this time",
        type: "string",
      })
      .option("compare", {
        describe: "Path to baseline JSON created with --json for comparison",
        type: "string",
      })
      .option("warn-latency", {
        describe: "Warn if any tool p95 latency exceeds this many milliseconds",
        type: "number",
      })
      .option("warn-errors", {
        describe: "Warn if total errors exceed this count",
        type: "number",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (args.clear) {
        await ToolHistory.clear()
        console.log("Cleared telemetry history.")
      }
      const history = await ToolHistory.read()
      const toolUsage = Object.fromEntries(Object.entries(history.tools).map(([tool, data]) => [tool, data.runs]))
      const telemetryFilter = args.telemetry?.trim()
      const statuses = parseList(args.status, true)
      const since = args.since ? parseTimeInput(args.since) : undefined
      const until = args.until ? parseTimeInput(args.until) : undefined
      const telemetryEvents = (() => {
        const base = (() => {
          if (!telemetryFilter) return history.events
          if (telemetryFilter === "all") return history.events
          return history.events.filter((event) => event.id === telemetryFilter)
        })()
        return base.filter((event) => {
          if (statuses.length > 0 && !statuses.includes(event.status)) return false
          if (since !== undefined && event.timestamp < since) return false
          if (until !== undefined && event.timestamp > until) return false
          return true
        })
      })()
      const limit = Math.max(1, args.limit ?? 20)
      const limitedTelemetry = telemetryEvents.slice(-limit)
      const telemetrySummary = summarizeTelemetry(telemetryEvents)

      const sessionMetrics = await aggregateSessions()
      const stats: SessionStats = {
        ...sessionMetrics,
        toolUsage,
        toolTelemetry: telemetrySummary.tools,
      }

      const comparison = args.compare ? await compareBaseline(args.compare, telemetrySummary) : undefined
      const warnings = collectWarnings(telemetrySummary, args.warnLatency, args.warnErrors)

      if (args.json) {
        const json = {
          stats,
          telemetry: limitedTelemetry,
          telemetrySummary,
          comparison,
          warnings,
        }
        console.log(JSON.stringify(json, null, 2))
        return
      }

      displayStats(stats)
      displayTelemetryWindow(telemetrySummary)
      if (telemetryFilter || telemetryEvents.length > 0) displayTelemetryEvents(limitedTelemetry)
      if (args.details) {
        displayTelemetryDetails(limitedTelemetry, {
          format: args.detailsFormat ?? "pretty",
          fields: parseList(args.fields),
        })
      }
      if (comparison) displayComparison(comparison)
      if (warnings.length > 0) {
        for (const note of warnings) console.log(note)
        const currentExit = typeof process.exitCode === "number" ? process.exitCode : 0
        if (currentExit < 2) process.exitCode = 2
      }
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

  if (Object.keys(stats.toolTelemetry ?? {}).length === 0) return

  console.log("┌─────────────────────── TOOL TELEMETRY ─────────────────────┐")
  console.log("│ Tool        Runs   Avg     P95     P99     Err%   Success │")
  console.log("├───────────────────────────────────────────────────────────┤")
  const sorted = Object.entries(stats.toolTelemetry).sort(([, a], [, b]) => b.runs - a.runs)
  for (const [tool, data] of sorted) {
    const avg = formatDurationShort(data.averageDuration)
    const p95 = formatDurationShort(data.p95Duration)
    const p99 = formatDurationShort(data.p99Duration)
    const errPercent = formatPercent(data.errorRate)
    const successPercent = formatPercent(data.successRate)
    const line = `│ ${tool.padEnd(10)} ${String(data.runs).padStart(4)} ${avg.padEnd(7)} ${p95.padEnd(7)} ${p99.padEnd(7)} ${errPercent.padEnd(
      6,
    )} ${successPercent.padEnd(7)} │`
    console.log(line)
  }
  console.log("└───────────────────────────────────────────────────────────┘")
  console.log()
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M"
  if (num >= 1000) return (num / 1000).toFixed(1) + "K"
  return num.toString()
}

function parseList(value?: string, lowercase = false): string[] {
  if (!value) return []
  return value
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (lowercase ? item.toLowerCase() : item))
}

function parseTimeInput(value: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  if (text === "now") return Date.now()
  const rel = text.match(/^(\d+)([smhdw])$/i)
  if (rel) {
    const amount = Number(rel[1])
    const unit = rel[2].toLowerCase()
    const factor = (() => {
      if (unit === "s") return 1000
      if (unit === "m") return 1000 * 60
      if (unit === "h") return 1000 * 60 * 60
      if (unit === "d") return 1000 * 60 * 60 * 24
      if (unit === "w") return 1000 * 60 * 60 * 24 * 7
      return 0
    })()
    return Date.now() - amount * factor
  }
  const date = new Date(text)
  if (!Number.isNaN(date.getTime())) return date.getTime()
  const numeric = Number(text)
  if (!Number.isNaN(numeric)) return numeric
  return undefined
}

function summarizeTelemetry(events: TelemetryEvent[]): TelemetrySummary {
  if (events.length === 0) return { totalRuns: 0, totalErrors: 0, tools: {} }

  const byTool = new Map<string, { runs: number; errors: number; totalDuration: number; durations: number[] }>()
  for (const event of events) {
    const existing = byTool.get(event.id)
    const entry = existing ?? { runs: 0, errors: 0, totalDuration: 0, durations: [] as number[] }
    if (!existing) byTool.set(event.id, entry)
    entry.runs += 1
    entry.totalDuration += event.duration
    entry.durations.push(event.duration)
    if (event.status === "error") entry.errors += 1
  }

  const timestamps = events.map((event) => event.timestamp)
  const windowStart = Math.min(...timestamps)
  const windowEnd = Math.max(...timestamps)
  const totalErrors = events.filter((event) => event.status === "error").length
  const tools: Record<string, ToolTelemetryStats> = {}

  for (const [tool, entry] of byTool.entries()) {
    const durations = entry.durations.toSorted((a, b) => a - b)
    const runs = entry.runs
    const errors = entry.errors
    const avg = runs > 0 ? entry.totalDuration / runs : 0
    const median = percentileFromSorted(durations, 50)
    const p95 = percentileFromSorted(durations, 95)
    const p99 = percentileFromSorted(durations, 99)
    const errorRate = runs > 0 ? errors / runs : 0
    const successRate = 1 - errorRate
    tools[tool] = {
      runs,
      errors,
      totalDuration: entry.totalDuration,
      averageDuration: avg,
      medianDuration: median,
      p95Duration: p95,
      p99Duration: p99,
      errorRate,
      successRate,
    }
  }

  const rangeMs = windowEnd - windowStart
  const perDayErrorRate = rangeMs > 0 ? totalErrors / Math.max(1, rangeMs / (1000 * 60 * 60 * 24)) : undefined

  return {
    windowStart,
    windowEnd,
    totalRuns: events.length,
    totalErrors,
    perDayErrorRate,
    tools,
  }
}

async function compareBaseline(path: string, current: TelemetrySummary): Promise<TelemetryComparison | undefined> {
  const file = Bun.file(path)
  const exists = await file.exists()
  if (!exists) return undefined
  const text = await file.text()
  const payload = JSON.parse(text)
  const baselineCandidate = (() => {
    if (payload.telemetrySummary) return payload.telemetrySummary
    if (Array.isArray(payload.telemetry)) return summarizeTelemetry(payload.telemetry as TelemetryEvent[])
    if (Array.isArray(payload)) return summarizeTelemetry(payload as TelemetryEvent[])
    return undefined
  })()
  if (!baselineCandidate) return undefined
  const baseline = normalizeTelemetrySummary(baselineCandidate)
  if (!baseline) return undefined
  return makeComparison(path, baseline, current)
}

function makeComparison(path: string, baseline: TelemetrySummary, current: TelemetrySummary): TelemetryComparison {
  const tools = new Set([...Object.keys(baseline.tools), ...Object.keys(current.tools)])
  const toolComparisons = Array.from(tools)
    .map((tool) => ({
      tool,
      baseline: baseline.tools[tool],
      current: current.tools[tool],
    }))
    .filter((entry) => entry.baseline || entry.current)

  return {
    path,
    totalRunsDelta: current.totalRuns - baseline.totalRuns,
    totalErrorsDelta: current.totalErrors - baseline.totalErrors,
    toolComparisons,
  }
}

function collectWarnings(summary: TelemetrySummary, warnLatency?: number, warnErrors?: number): string[] {
  const notes: string[] = []
  if (warnLatency !== undefined) {
    const offenders = Object.entries(summary.tools).filter(([, data]) => data.p95Duration > warnLatency)
    for (const [tool, data] of offenders) {
      notes.push(`⚠ ${tool} p95 ${formatDurationShort(data.p95Duration)} exceeds ${formatDurationShort(warnLatency)}`)
    }
  }
  if (warnErrors !== undefined && summary.totalErrors > warnErrors) {
    notes.push(`⚠ Total telemetry errors ${summary.totalErrors} exceed ${warnErrors}`)
  }
  return notes
}

function displayTelemetryWindow(summary: TelemetrySummary) {
  if (summary.totalRuns === 0) {
    console.log("No telemetry events recorded for the selected window.")
    console.log()
    return
  }
  const start = summary.windowStart ? formatTimestamp(summary.windowStart) : "unknown"
  const end = summary.windowEnd ? formatTimestamp(summary.windowEnd) : "unknown"
  const windowLine = `Telemetry window: ${start} → ${end}`
  console.log(windowLine)
  const metrics = [`runs ${summary.totalRuns}`, `errors ${summary.totalErrors}`]
  if (summary.perDayErrorRate !== undefined) metrics.push(`errors/day ${summary.perDayErrorRate.toFixed(2)}`)
  console.log(metrics.join(" • "))
  console.log()
}

function displayComparison(comparison: TelemetryComparison) {
  console.log(`Baseline comparison (${comparison.path}):`)
  console.log(
    [
      ` total runs ${formatSigned(comparison.totalRunsDelta)}`,
      ` total errors ${formatSigned(comparison.totalErrorsDelta)}`,
    ].join(" • "),
  )
  if (comparison.toolComparisons.length === 0) {
    console.log()
    return
  }
  for (const item of comparison.toolComparisons.sort((a, b) => a.tool.localeCompare(b.tool))) {
    const current = item.current
    const baseline = item.baseline
    if (!current && !baseline) continue
    const runsDelta = current && baseline ? current.runs - baseline.runs : current ? current.runs : -baseline!.runs
    const p95Delta = (() => {
      if (current && baseline) return current.p95Duration - baseline.p95Duration
      if (current) return current.p95Duration
      return -baseline!.p95Duration
    })()
    const errorRateDelta = (() => {
      if (current && baseline) return current.errorRate - baseline.errorRate
      if (current) return current.errorRate
      return -baseline!.errorRate
    })()
    const parts = [`${item.tool}: Δruns ${formatSigned(runsDelta)}`]
    parts.push(`Δp95 ${formatSignedDuration(p95Delta)}`)
    parts.push(`Δerr ${formatSignedPercent(errorRateDelta)}`)
    if (current && baseline && baseline.p95Duration > 0) {
      const ratio = current.p95Duration / baseline.p95Duration
      if (ratio >= 3) parts.push(`⚠ p95 ${ratio.toFixed(1)}x`)
    }
    if (current && baseline && baseline.errorRate > 0) {
      const ratio = current.errorRate / baseline.errorRate
      if (ratio >= 3) parts.push(`⚠ err ${ratio.toFixed(1)}x`)
    }
    if (current && !baseline && current.runs > 0) parts.push("⚠ new tool")
    if (!current && baseline && baseline.runs > 0) parts.push("⚠ missing tool")
    console.log(parts.join(" • "))
  }
  console.log()
}

function displayTelemetryEvents(events: TelemetryEvent[]) {
  if (events.length === 0) {
    console.log("No telemetry events match the provided filter.")
    return
  }
  console.log("┌──────────────────────── TELEMETRY EVENTS ─────────────────────────┐")
  console.log("│ Time                 Tool   Status  Duration  Session   Message               │")
  console.log("├──────────────────────────────────────────────────────────────────┤")
  for (const event of events) {
    const date = formatTimestamp(event.timestamp)
    const status = event.status === "success" ? "OK" : "ERR"
    const duration = formatDurationShort(event.duration)
    const session = event.sessionID.slice(-8)
    const message = event.error ? event.error.slice(0, 30) : ""
    const line = `│ ${date} ${event.id.padEnd(6)} ${status.padEnd(6)} ${duration.padEnd(8)} ${session.padEnd(8)} ${message.padEnd(
      22,
    )} │`
    console.log(line)
  }
  console.log("└──────────────────────────────────────────────────────────────────┘")
}

function displayTelemetryDetails(events: TelemetryEvent[], options: DetailOptions) {
  if (events.length === 0) {
    console.log("No telemetry metadata found for the selected events.")
    return
  }

  if (options.format === "ndjson") {
    for (const event of events) {
      const extra = filterExtra(event.extra, options.fields)
      const payload = {
        timestamp: event.timestamp,
        time: formatTimestamp(event.timestamp),
        tool: event.id,
        status: event.status,
        duration: event.duration,
        session: event.sessionID,
        call: event.callID,
        error: event.error,
        extra,
      }
      console.log(JSON.stringify(payload))
    }
    return
  }

  if (options.format === "csv") {
    const baseFields = ["timestamp", "time", "tool", "status", "duration", "session", "call", "error"]
    const extraKeys = collectFieldNames(events, options.fields)
    const header = [...baseFields, ...extraKeys]
    console.log(header.join(","))
    for (const event of events) {
      const baseRow = [
        String(event.timestamp),
        formatTimestamp(event.timestamp),
        event.id,
        event.status,
        String(event.duration),
        event.sessionID,
        event.callID ?? "",
        event.error ?? "",
      ]
      const extra = filterExtra(event.extra, options.fields)
      const extras = extraKeys.map((key) => toCSVValue(extra?.[key]))
      console.log([...baseRow, ...extras].join(","))
    }
    return
  }

  console.log("Telemetry details:")
  const hasMetadata = events.some((event) => {
    const extra = filterExtra(event.extra, options.fields)
    if (!extra) return false
    return Object.keys(extra).length > 0
  })
  if (!hasMetadata) {
    console.log("No telemetry metadata found for the selected events.")
    return
  }
  for (const event of events) {
    const extra = filterExtra(event.extra, options.fields)
    if (!extra || Object.keys(extra).length === 0) continue
    const header = `${formatTimestamp(event.timestamp)} ${event.id} (${event.status})`
    console.log(header)
    console.log(`  session: ${event.sessionID}  # opencode run --session ${event.sessionID}`)
    if (event.callID) console.log(`  call: ${event.callID}`)
    console.log(`  duration: ${formatDurationShort(event.duration)}`)
    if (event.error) console.log(`  error: ${event.error}`)
    for (const key of Object.keys(extra).sort()) {
      console.log(`  ${key}: ${formatValue(extra[key])}`)
    }
    console.log()
  }
}

function formatValue(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join(", ")
  return JSON.stringify(value)
}

function filterExtra(extra: TelemetryEvent["extra"], fields: string[]) {
  if (!extra) return undefined
  if (fields.length === 0) return extra
  const picked: Record<string, unknown> = {}
  for (const key of fields) {
    if (key in extra) picked[key] = extra[key]
  }
  return picked
}

function collectFieldNames(events: TelemetryEvent[], requested: string[]): string[] {
  if (requested.length > 0) return Array.from(new Set(requested))
  const names = new Set<string>()
  for (const event of events) {
    if (!event.extra) continue
    Object.keys(event.extra).forEach((key) => names.add(key))
  }
  return Array.from(names).sort()
}

function toCSVValue(value: unknown): string {
  if (value === undefined) return ""
  const raw = formatValue(value)
  if (raw.includes(",") || raw.includes('"')) return `"${raw.replace(/"/g, '""')}"`
  return raw
}

function percentileFromSorted(values: number[], target: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0]
  const rank = (target / 100) * (values.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return values[lower]
  const weight = rank - lower
  return values[lower] * (1 - weight) + values[upper] * weight
}

function formatDurationShort(duration: number): string {
  if (duration < 1000) return `${duration.toFixed(0)}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`
  return `${(duration / 60000).toFixed(2)}m`
}

function formatSigned(value: number): string {
  if (value === 0) return "±0"
  return value > 0 ? `+${value}` : `${value}`
}

function formatSignedDuration(value: number): string {
  if (value === 0) return "±0ms"
  const label = formatDurationShort(Math.abs(value))
  return value > 0 ? `+${label}` : `-${label}`
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatSignedPercent(value: number): string {
  if (value === 0) return "±0.0%"
  const abs = (Math.abs(value) * 100).toFixed(1)
  return value > 0 ? `+${abs}%` : `-${abs}%`
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").split(".")[0]
}

function normalizeTelemetrySummary(input: any): TelemetrySummary | undefined {
  if (!input || typeof input !== "object") return undefined
  const rawTools = (input as any).tools
  const tools: Record<string, ToolTelemetryStats> = {}
  if (rawTools && typeof rawTools === "object") {
    for (const [tool, raw] of Object.entries(rawTools as Record<string, any>)) {
      const runs = Number(raw?.runs ?? 0)
      const errors = Number(raw?.errors ?? 0)
      const totalDuration = Number(raw?.totalDuration ?? 0)
      const avg = Number(raw?.averageDuration ?? (runs > 0 ? totalDuration / runs : 0))
      const median = Number(raw?.medianDuration ?? avg)
      const p95 = Number(raw?.p95Duration ?? median)
      const p99 = Number(raw?.p99Duration ?? p95)
      const errorRate = runs > 0 ? errors / runs : 0
      const successRate = 1 - errorRate
      tools[tool] = {
        runs,
        errors,
        totalDuration,
        averageDuration: avg,
        medianDuration: median,
        p95Duration: p95,
        p99Duration: p99,
        errorRate,
        successRate,
      }
    }
  }
  const totals = Object.values(tools)
  const totalRuns =
    typeof input.totalRuns === "number" ? input.totalRuns : totals.reduce((sum, entry) => sum + entry.runs, 0)
  const totalErrors =
    typeof input.totalErrors === "number" ? input.totalErrors : totals.reduce((sum, entry) => sum + entry.errors, 0)
  const perDayErrorRate = typeof input.perDayErrorRate === "number" ? input.perDayErrorRate : undefined
  const windowStart = typeof input.windowStart === "number" ? input.windowStart : undefined
  const windowEnd = typeof input.windowEnd === "number" ? input.windowEnd : undefined
  return {
    windowStart,
    windowEnd,
    totalRuns,
    totalErrors,
    perDayErrorRate,
    tools,
  }
}
