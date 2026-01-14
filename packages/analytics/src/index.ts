import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin"

interface Counter {
  name: string
  help: string
  labels: string[]
  values: Map<string, number>
}

interface Histogram {
  name: string
  help: string
  labels: string[]
  buckets: number[]
  values: Map<string, { count: number; sum: number; buckets: Map<number, number> }>
}

interface Gauge {
  name: string
  help: string
  labels: string[]
  values: Map<string, number>
}

const inflightCalls = new Map<string, { tool: string; startTime: number; sessionID: string }>()
const counters: Map<string, Counter> = new Map()
const histograms: Map<string, Histogram> = new Map()
const gauges: Map<string, Gauge> = new Map()
const DEFAULT_BUCKETS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000]

function getLabelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",")
}

function incCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
  const counter = counters.get(name)
  if (!counter) return
  const key = getLabelKey(labels)
  counter.values.set(key, (counter.values.get(key) ?? 0) + value)
}

function registerCounter(name: string, help: string, labels: string[] = []): void {
  if (counters.has(name)) return
  counters.set(name, { name, help, labels, values: new Map() })
}

function observeHistogram(name: string, labels: Record<string, string>, value: number): void {
  const histogram = histograms.get(name)
  if (!histogram) return
  const key = getLabelKey(labels)

  let entry = histogram.values.get(key)
  if (!entry) {
    entry = { count: 0, sum: 0, buckets: new Map() }
    for (const bucket of histogram.buckets) {
      entry.buckets.set(bucket, 0)
    }
    histogram.values.set(key, entry)
  }

  entry.count++
  entry.sum += value
  for (const bucket of histogram.buckets) {
    if (value <= bucket) {
      entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1)
    }
  }
}

function registerHistogram(name: string, help: string, labels: string[] = [], buckets = DEFAULT_BUCKETS): void {
  if (histograms.has(name)) return
  histograms.set(name, { name, help, labels, buckets, values: new Map() })
}

function setGauge(name: string, labels: Record<string, string>, value: number): void {
  const gauge = gauges.get(name)
  if (!gauge) return
  const key = getLabelKey(labels)
  gauge.values.set(key, value)
}

function incGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
  const gauge = gauges.get(name)
  if (!gauge) return
  const key = getLabelKey(labels)
  gauge.values.set(key, (gauge.values.get(key) ?? 0) + value)
}

function decGauge(name: string, labels: Record<string, string> = {}, value = 1): void {
  incGauge(name, labels, -value)
}

function registerGauge(name: string, help: string, labels: string[] = []): void {
  if (gauges.has(name)) return
  gauges.set(name, { name, help, labels, values: new Map() })
}

export function formatMetrics(): string {
  const lines: string[] = []

  for (const counter of counters.values()) {
    lines.push(`# HELP ${counter.name} ${counter.help}`)
    lines.push(`# TYPE ${counter.name} counter`)
    for (const [labels, value] of counter.values) {
      const labelStr = labels ? `{${labels}}` : ""
      lines.push(`${counter.name}${labelStr} ${value}`)
    }
  }

  for (const histogram of histograms.values()) {
    lines.push(`# HELP ${histogram.name} ${histogram.help}`)
    lines.push(`# TYPE ${histogram.name} histogram`)
    for (const [labels, entry] of histogram.values) {
      const baseLabels = labels ? labels + "," : ""
      for (const [bucket, count] of entry.buckets) {
        lines.push(`${histogram.name}_bucket{${baseLabels}le="${bucket}"} ${count}`)
      }
      lines.push(`${histogram.name}_bucket{${baseLabels}le="+Inf"} ${entry.count}`)
      lines.push(`${histogram.name}_sum{${labels || ""}} ${entry.sum}`)
      lines.push(`${histogram.name}_count{${labels || ""}} ${entry.count}`)
    }
  }

  for (const gauge of gauges.values()) {
    lines.push(`# HELP ${gauge.name} ${gauge.help}`)
    lines.push(`# TYPE ${gauge.name} gauge`)
    for (const [labels, value] of gauge.values) {
      const labelStr = labels ? `{${labels}}` : ""
      lines.push(`${gauge.name}${labelStr} ${value}`)
    }
  }

  return lines.join("\n")
}

export function getMetricsJSON(): {
  counters: Record<string, Record<string, number>>
  histograms: Record<string, Record<string, { count: number; sum: number; mean: number }>>
  gauges: Record<string, Record<string, number>>
} {
  const result: ReturnType<typeof getMetricsJSON> = {
    counters: {},
    histograms: {},
    gauges: {},
  }

  for (const counter of counters.values()) {
    result.counters[counter.name] = Object.fromEntries(counter.values)
  }

  for (const histogram of histograms.values()) {
    result.histograms[histogram.name] = {}
    for (const [labels, entry] of histogram.values) {
      result.histograms[histogram.name][labels || "_total"] = {
        count: entry.count,
        sum: entry.sum,
        mean: entry.count > 0 ? entry.sum / entry.count : 0,
      }
    }
  }

  for (const gauge of gauges.values()) {
    result.gauges[gauge.name] = Object.fromEntries(gauge.values)
  }

  return result
}

function initMetrics(): void {
  registerCounter("opencode_tool_calls_total", "Total number of tool calls", ["tool", "status"])
  registerHistogram("opencode_tool_duration_ms", "Tool execution duration in milliseconds", ["tool"])
  registerGauge("opencode_tool_calls_inflight", "Number of tool calls currently in progress", ["tool"])
  registerGauge("opencode_sessions_active", "Number of active sessions", [])
  registerCounter("opencode_messages_total", "Total number of messages", ["type"])
  registerCounter("opencode_tokens_total", "Total tokens used", ["type", "model"])
  registerCounter("opencode_errors_total", "Total errors", ["type"])
}

export const analytics: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  initMetrics()

  const activeSessions = new Set<string>()

  return {
    async event({ event }) {
      if (event.type === "session.created") {
        const sessionId = (event.properties as { info: { id: string } }).info.id
        activeSessions.add(sessionId)
        setGauge("opencode_sessions_active", {}, activeSessions.size)
      } else if (event.type === "session.deleted") {
        const sessionId = (event.properties as { info: { id: string } }).info.id
        activeSessions.delete(sessionId)
        setGauge("opencode_sessions_active", {}, activeSessions.size)
      }
    },

    async "chat.message"({ sessionID }, { message: _message }) {
      incCounter("opencode_messages_total", { type: "user" })

      if (!activeSessions.has(sessionID)) {
        activeSessions.add(sessionID)
        setGauge("opencode_sessions_active", {}, activeSessions.size)
      }
    },

    async "tool.execute.before"({ tool, sessionID, callID }, { args: _args }) {
      const key = `${sessionID}:${callID}`
      inflightCalls.set(key, { tool, startTime: Date.now(), sessionID })
      incGauge("opencode_tool_calls_inflight", { tool })
    },

    async "tool.execute.after"({ tool, sessionID, callID }, { title: _title, output: _output, metadata }) {
      const key = `${sessionID}:${callID}`
      const inflight = inflightCalls.get(key)

      if (inflight) {
        const duration = Date.now() - inflight.startTime
        observeHistogram("opencode_tool_duration_ms", { tool }, duration)

        const status = metadata?.error ? "error" : "success"
        incCounter("opencode_tool_calls_total", { tool, status })
        decGauge("opencode_tool_calls_inflight", { tool })
        inflightCalls.delete(key)
      } else {
        const status = metadata?.error ? "error" : "success"
        incCounter("opencode_tool_calls_total", { tool, status })
      }

      if (metadata?.error) {
        incCounter("opencode_errors_total", { type: "tool_error" })
      }
    },

    tool: {
      metrics: {
        description: "Get Prometheus-compatible metrics for OpenCode usage",
        args: {},
        async execute() {
          return formatMetrics()
        },
      },
    },
  }
}

export default analytics
