/**
 * Pure, side-effect-free derivations for the /usage stats screen.
 *
 * The UI layer is responsible for collecting raw records (from sync + the
 * session API); everything in this file operates on already-normalized
 * `Record` objects. That makes the logic trivial to unit test and safe to
 * call from any context.
 */

export type UsageRecord = {
  /** ms since epoch */
  timestamp: number
  model: string
  input: number
  output: number
  sessionID: string
  /** ms since epoch for the session boundary (optional) */
  sessionStart?: number
  sessionEnd?: number
}

export type DateRange = "all" | "7d" | "30d"

export const DATE_RANGES: { id: DateRange; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
]

const MS_DAY = 24 * 60 * 60 * 1000

/** Compute the inclusive [start, end] day bounds for a date range in local time. */
export function rangeBounds(range: DateRange, now: number = Date.now()): { start: number; end: number } | undefined {
  const end = endOfDay(now)
  if (range === "all") return undefined
  const days = range === "7d" ? 7 : 30
  const start = startOfDay(now - (days - 1) * MS_DAY)
  return { start, end }
}

export function filterByRange(records: UsageRecord[], range: DateRange, now: number = Date.now()): UsageRecord[] {
  const bounds = rangeBounds(range, now)
  if (!bounds) return records
  return records.filter((r) => r.timestamp >= bounds.start && r.timestamp <= bounds.end)
}

/** YYYY-MM-DD key in local time. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function totalTokens(records: UsageRecord[]): number {
  let total = 0
  for (const r of records) total += r.input + r.output
  return total
}

/**
 * Per-day bucketing: groups records by local-time day and totals input/output.
 * Result is sorted ascending by day key.
 */
export function tokensPerDay(records: UsageRecord[]): { day: string; input: number; output: number; total: number }[] {
  const map = new Map<string, { input: number; output: number }>()
  for (const r of records) {
    const k = dayKey(r.timestamp)
    const entry = map.get(k) ?? { input: 0, output: 0 }
    entry.input += r.input
    entry.output += r.output
    map.set(k, entry)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([day, v]) => ({ day, input: v.input, output: v.output, total: v.input + v.output }))
}

/** Per-(model, day) bucketing. Useful for the multi-series chart. */
export function tokensPerModelPerDay(
  records: UsageRecord[],
): Map<string, { day: string; total: number; input: number; output: number }[]> {
  const perModel = new Map<string, Map<string, { input: number; output: number }>>()
  for (const r of records) {
    const modelMap = perModel.get(r.model) ?? new Map<string, { input: number; output: number }>()
    const k = dayKey(r.timestamp)
    const entry = modelMap.get(k) ?? { input: 0, output: 0 }
    entry.input += r.input
    entry.output += r.output
    modelMap.set(k, entry)
    perModel.set(r.model, modelMap)
  }
  const result = new Map<string, { day: string; total: number; input: number; output: number }[]>()
  for (const [model, map] of perModel) {
    const series = [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([day, v]) => ({ day, total: v.input + v.output, input: v.input, output: v.output }))
    result.set(model, series)
  }
  return result
}

/** Per-model totals with share %, sorted desc by total. */
export function perModelShare(
  records: UsageRecord[],
): { model: string; input: number; output: number; total: number; share: number }[] {
  const map = new Map<string, { input: number; output: number }>()
  for (const r of records) {
    const entry = map.get(r.model) ?? { input: 0, output: 0 }
    entry.input += r.input
    entry.output += r.output
    map.set(r.model, entry)
  }
  const total = [...map.values()].reduce((s, v) => s + v.input + v.output, 0)
  const list = [...map.entries()].map(([model, v]) => ({
    model,
    input: v.input,
    output: v.output,
    total: v.input + v.output,
    share: total > 0 ? (v.input + v.output) / total : 0,
  }))
  list.sort((a, b) => b.total - a.total)
  return list
}

export function favoriteModel(records: UsageRecord[]): string | undefined {
  const list = perModelShare(records)
  return list[0]?.model
}

export function distinctSessions(records: UsageRecord[]): number {
  const set = new Set<string>()
  for (const r of records) set.add(r.sessionID)
  return set.size
}

/** Active days (distinct dayKeys that have > 0 tokens). */
export function activeDays(records: UsageRecord[]): string[] {
  const set = new Set<string>()
  for (const r of records) {
    if (r.input + r.output > 0) set.add(dayKey(r.timestamp))
  }
  return [...set].sort()
}

/** The single day with the highest total tokens. */
export function mostActiveDay(records: UsageRecord[]): { day: string; total: number } | undefined {
  const perDay = tokensPerDay(records)
  let best: { day: string; total: number } | undefined
  for (const item of perDay) {
    if (!best || item.total > best.total) best = { day: item.day, total: item.total }
  }
  return best
}

/**
 * Longest session duration. Uses sessionStart/sessionEnd if provided; otherwise
 * derives min/max timestamp per sessionID from records.
 */
export function longestSessionMs(records: UsageRecord[]): number {
  if (records.length === 0) return 0
  const bySession = new Map<string, { start: number; end: number }>()
  for (const r of records) {
    const existing = bySession.get(r.sessionID)
    const start = r.sessionStart ?? r.timestamp
    const end = r.sessionEnd ?? r.timestamp
    if (!existing) {
      bySession.set(r.sessionID, { start, end })
    } else {
      if (start < existing.start) existing.start = start
      if (end > existing.end) existing.end = end
    }
  }
  let longest = 0
  for (const { start, end } of bySession.values()) {
    const dur = Math.max(0, end - start)
    if (dur > longest) longest = dur
  }
  return longest
}

/**
 * Streaks of consecutive active days.
 *  - `longest`: the longest run anywhere.
 *  - `current`: the run ending today (0 if today is not active).
 *
 * `now` controls the "today" reference — accepts an epoch ms.
 */
export function streaks(records: UsageRecord[], now: number = Date.now()): { longest: number; current: number } {
  const days = activeDays(records)
  if (days.length === 0) return { longest: 0, current: 0 }

  const daySet = new Set(days)
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    if (isNextDay(days[i - 1], days[i])) {
      run++
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }

  const today = dayKey(now)
  let current = 0
  if (daySet.has(today)) {
    current = 1
    let cursor = today
    while (true) {
      const prev = prevDay(cursor)
      if (!daySet.has(prev)) break
      current++
      cursor = prev
    }
  }
  return { longest, current }
}

function prevDay(key: string): string {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10))
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return dayKey(date.getTime())
}

function isNextDay(a: string, b: string): boolean {
  return prevDay(b) === a
}

/* ---------- formatting ---------- */

/** Compact number format: 448, 2.5k, 141.9k, 670.6k, 4.2M. */
export function formatCompact(n: number): string {
  if (!isFinite(n)) return "0"
  const abs = Math.abs(n)
  if (abs < 1000) return `${Math.round(n)}`
  if (abs < 1_000_000) {
    const v = n / 1000
    return `${trim(v)}k`
  }
  if (abs < 1_000_000_000) {
    const v = n / 1_000_000
    return `${trim(v)}M`
  }
  const v = n / 1_000_000_000
  return `${trim(v)}B`
}

function trim(n: number): string {
  const rounded = Math.round(n * 10) / 10
  if (Number.isInteger(rounded)) return `${rounded}`
  return rounded.toFixed(1)
}

/** Format a duration in ms as "9h 42m 28s" (omits leading zero units). */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "0s"
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86_400)
  const h = Math.floor((totalSec % 86_400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0 || d > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(" ")
}

/** Format a share ratio (0..1) as "12.3%"; drops trailing .0 for clean ints. */
export function formatPct(share: number): string {
  const pct = share * 100
  const rounded = Math.round(pct * 10) / 10
  if (Number.isInteger(rounded)) return `${rounded}%`
  return `${rounded.toFixed(1)}%`
}

/** Compact date label — "Apr 20". */
export function formatShortDate(dayKeyOrMs: string | number): string {
  const ms = typeof dayKeyOrMs === "string" ? parseDayKey(dayKeyOrMs) : dayKeyOrMs
  const d = new Date(ms)
  return d.toLocaleString("en-US", { month: "short", day: "numeric" })
}

export function parseDayKey(key: string): number {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10))
  return new Date(y, m - 1, d).getTime()
}

/* ---------- comparison reference ---------- */

/** Reference table of well-known works (approx. tokens). Tuned for fun. */
export const COMPARISON_WORKS: { name: string; tokens: number }[] = [
  { name: "a tweet", tokens: 70 },
  { name: "an email", tokens: 250 },
  { name: "an essay", tokens: 2_500 },
  { name: "The Communist Manifesto", tokens: 22_000 },
  { name: "Animal Farm", tokens: 40_000 },
  { name: "The Great Gatsby", tokens: 65_000 },
  { name: "To Kill a Mockingbird", tokens: 130_000 },
  { name: "Pride and Prejudice", tokens: 160_000 },
  { name: "The Hobbit", tokens: 125_000 },
  { name: "1984", tokens: 120_000 },
  { name: "Moby Dick", tokens: 280_000 },
  { name: "Harry Potter and the Sorcerer's Stone", tokens: 105_000 },
  { name: "The Lord of the Rings", tokens: 625_000 },
  { name: "War and Peace", tokens: 780_000 },
  { name: "Les Misérables", tokens: 720_000 },
  { name: "the Bible (KJV)", tokens: 1_050_000 },
  { name: "the complete works of Shakespeare", tokens: 1_200_000 },
]

/**
 * Pick the most readable comparison. Targets a multiplier roughly between
 * 1.5x and 500x so the line stays fun and believable. Returns undefined when
 * no good comparison exists (very low totals).
 */
export function compareToWork(tokens: number): { name: string; multiplier: number } | undefined {
  if (tokens < 500) return undefined
  const candidates = COMPARISON_WORKS.map((w) => ({
    work: w,
    multiplier: tokens / w.tokens,
  }))
  const readable = candidates.filter((c) => c.multiplier >= 1.2 && c.multiplier <= 500)
  const pool = readable.length > 0 ? readable : candidates
  // Score: prefer multipliers in the "1.5x..20x" sweet spot (on a log scale),
  // and prefer well-known literary works over trivial baselines.
  const sweet = Math.log(6)
  pool.sort((a, b) => {
    const da = Math.abs(Math.log(a.multiplier) - sweet)
    const db = Math.abs(Math.log(b.multiplier) - sweet)
    if (Math.abs(da - db) > 0.05) return da - db
    return b.work.tokens - a.work.tokens
  })
  const best = pool[0]
  if (!best) return undefined
  return { name: best.work.name, multiplier: best.multiplier }
}

export function formatMultiplier(m: number): string {
  if (m < 2) return m.toFixed(1) + "x"
  if (m < 10) return m.toFixed(1) + "x"
  return Math.round(m) + "x"
}

/* ---------- heatmap helpers ---------- */

/** Build a year-view heatmap grid. Columns are weeks (Sun..Sat rows). */
export function heatmapGrid(
  records: UsageRecord[],
  end: number = Date.now(),
  weeks: number = 53,
): {
  weeks: { day: string | undefined; total: number }[][]
  monthLabels: { label: string; week: number }[]
  max: number
} {
  const perDay = new Map<string, number>()
  for (const r of records) {
    const k = dayKey(r.timestamp)
    perDay.set(k, (perDay.get(k) ?? 0) + r.input + r.output)
  }

  // Anchor the grid to the end of the week containing `end` so the last
  // column is the current week.
  const endDate = new Date(end)
  endDate.setHours(0, 0, 0, 0)
  const dow = endDate.getDay()
  const gridEnd = new Date(endDate)
  gridEnd.setDate(endDate.getDate() + (6 - dow))

  const grid: { day: string | undefined; total: number }[][] = []
  let max = 0
  for (let w = weeks - 1; w >= 0; w--) {
    const col: { day: string | undefined; total: number }[] = []
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(gridEnd)
      cellDate.setDate(gridEnd.getDate() - w * 7 - (6 - d))
      const key = dayKey(cellDate.getTime())
      if (cellDate > endDate) {
        col.push({ day: undefined, total: 0 })
      } else {
        const total = perDay.get(key) ?? 0
        if (total > max) max = total
        col.push({ day: key, total })
      }
    }
    grid.push(col)
  }

  // Month labels: put the month's short name on the first week where a cell
  // falls on the 1st..7th of that month and the previous week does not.
  const monthLabels: { label: string; week: number }[] = []
  let lastMonth = -1
  for (let i = 0; i < grid.length; i++) {
    const col = grid[i]
    const firstDay = col.find((c) => c.day)
    if (!firstDay?.day) continue
    const month = parseDayKey(firstDay.day)
    const m = new Date(month).getMonth()
    if (m !== lastMonth) {
      monthLabels.push({
        label: new Date(month).toLocaleString("en-US", { month: "short" }),
        week: i,
      })
      lastMonth = m
    }
  }

  return { weeks: grid, monthLabels, max }
}

/** Bucket a value into one of 5 intensity levels (0..4). */
export function heatmapLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio < 0.1) return 1
  if (ratio < 0.3) return 2
  if (ratio < 0.6) return 3
  return 4
}
