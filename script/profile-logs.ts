import fs from "fs"
import path from "path"

let logFile = process.argv[2] ?? process.env.OPENCODE_LOG

if (!logFile) {
  const logDir = path.join(process.env.HOME ?? "", ".opencode", "log")
  const files = fs.readdirSync(logDir).sort().reverse()
  const latest = files.find((f) => f.endsWith(".log"))
  if (!latest) {
    console.error("No log file found. Pass log file path as argument or set OPENCODE_LOG env var.")
    process.exit(1)
  }
  logFile = path.join(logDir, latest)
}

const content = fs.readFileSync(logFile, "utf-8")
const lines = content.split("\n").filter(Boolean)

const lineRegex = /^(\S+)\s+\+(\d+)ms\s+(.*)$/
const tagRegex = /(\w+)=([^\s]+)/g

interface Metric {
  count: number
  totalMs: number
  maxMs: number
  minMs: number
  service: string
  operation: string
  tags: Record<string, string>
}

const metrics = new Map<string, Metric>()

for (const line of lines) {
  const match = line.match(lineRegex)
  if (!match) continue

  const duration = parseInt(match[2]!)
  const rest = match[3]!

  const tags: Record<string, string> = {}
  let tagMatch
  while ((tagMatch = tagRegex.exec(rest)) !== null) {
    tags[tagMatch[1]!] = tagMatch[2]!
  }
  tagRegex.lastIndex = 0

  const service = tags.service ?? "unknown"
  const status = tags.status ?? ""
  const message = rest.replace(tagRegex, "").trim()
  tagRegex.lastIndex = 0

  if (status === "started") continue

  const key = `${service}:${message}`

  const existing = metrics.get(key)
  if (existing) {
    existing.count++
    existing.totalMs += duration
    existing.maxMs = Math.max(existing.maxMs, duration)
    existing.minMs = Math.min(existing.minMs, duration)
  } else {
    metrics.set(key, {
      count: 1,
      totalMs: duration,
      maxMs: duration,
      minMs: duration,
      service,
      operation: message,
      tags,
    })
  }
}

const sorted = Array.from(metrics.values()).sort((a, b) => b.totalMs - a.totalMs)

console.log(`\n📊 OpenCode Performance Report`)
console.log(`Log file: ${logFile}`)
console.log(`Lines parsed: ${lines.length}`)
console.log(`Unique operations: ${sorted.length}\n`)

console.log("═══ TOP 20 BY TOTAL TIME ═══")
console.log(
  [
    "Operation".padEnd(50),
    "Count".padStart(6),
    "Total".padStart(8),
    "Avg".padStart(7),
    "Max".padStart(7),
    "Min".padStart(7),
  ].join(" │ "),
)
console.log("─".repeat(95))

for (const m of sorted.slice(0, 20)) {
  const label = `${m.service}: ${m.operation}`.slice(0, 50).padEnd(50)
  console.log(
    [
      label,
      String(m.count).padStart(6),
      `${m.totalMs}ms`.padStart(8),
      `${Math.round(m.totalMs / m.count)}ms`.padStart(7),
      `${m.maxMs}ms`.padStart(7),
      `${m.minMs}ms`.padStart(7),
    ].join(" │ "),
  )
}

console.log("\n═══ TOP 20 BY CALL COUNT ═══")
const byCount = [...sorted].sort((a, b) => b.count - a.count)
console.log(
  ["Operation".padEnd(50), "Count".padStart(6), "Total".padStart(8), "Avg".padStart(7), "Max".padStart(7)].join(" │ "),
)
console.log("─".repeat(95))

for (const m of byCount.slice(0, 20)) {
  const label = `${m.service}: ${m.operation}`.slice(0, 50).padEnd(50)
  console.log(
    [
      label,
      String(m.count).padStart(6),
      `${m.totalMs}ms`.padStart(8),
      `${Math.round(m.totalMs / m.count)}ms`.padStart(7),
      `${m.maxMs}ms`.padStart(7),
    ].join(" │ "),
  )
}

console.log("\n═══ BY SERVICE ═══")
const serviceMap = new Map<string, { count: number; totalMs: number }>()
for (const m of sorted) {
  const existing = serviceMap.get(m.service) ?? { count: 0, totalMs: 0 }
  existing.count += m.count
  existing.totalMs += m.totalMs
  serviceMap.set(m.service, existing)
}

const serviceSorted = Array.from(serviceMap.entries()).sort((a, b) => b[1].totalMs - a[1].totalMs)
console.log(
  ["Service".padEnd(30), "Calls".padStart(8), "Total Time".padStart(12), "% of Total".padStart(10)].join(" │ "),
)
console.log("─".repeat(65))

const grandTotal = serviceSorted.reduce((sum, [, s]) => sum + s.totalMs, 0)
for (const [service, data] of serviceSorted) {
  const pct = grandTotal > 0 ? ((data.totalMs / grandTotal) * 100).toFixed(1) : "0.0"
  console.log(
    [service.padEnd(30), String(data.count).padStart(8), `${data.totalMs}ms`.padStart(12), `${pct}%`.padStart(10)].join(
      " │ ",
    ),
  )
}

console.log(`\nGrand total: ${grandTotal}ms across ${serviceSorted.reduce((s, [, d]) => s + d.count, 0)} operations\n`)
