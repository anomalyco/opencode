import type { SessionStatsInfo } from "@opencode-ai/client"

export const periods = ["year", "month", "week", "all"] as const
export type StatsPeriod = (typeof periods)[number]

export function statsRange(period: StatsPeriod, now = new Date()) {
  const to = now.getTime() + 1
  if (period === "all") return { from: undefined, to, label: "All time" }
  if (period === "year")
    return { from: new Date(now.getFullYear(), 0, 1).getTime(), to, label: `${now.getFullYear()} so far` }
  if (period === "month")
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      to,
      label: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    }
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  return { from: from.getTime(), to, label: "Last 7 days" }
}

export function statsMetrics(stats: SessionStatsInfo) {
  return [
    {
      label: "tokens",
      value:
        stats.tokens.input +
        stats.tokens.output +
        stats.tokens.reasoning +
        stats.tokens.cache.read +
        stats.tokens.cache.write,
    },
    { label: "best streak", value: stats.streak },
    { label: "active days", value: stats.activeDays },
    { label: "sessions", value: stats.sessions },
  ]
}

export function statsNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

// Calendar arithmetic uses UTC ordinals after extracting local dates, so DST cannot add or drop a cell.
export function statsCalendar(stats: SessionStatsInfo, width: number) {
  const ordinal = (time: number) => {
    const date = new Date(time)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  }
  const from = ordinal(stats.range.from)
  const to = ordinal(stats.range.to - 1)
  const monday = from - ((new Date(from * 86_400_000).getUTCDay() + 6) % 7)
  const total = Math.floor((to - monday) / 7) + 1
  const count = Math.max(1, Math.min(53, Math.floor((width - 4) / 2), total))
  const start = monday + Math.max(0, total - count) * 7
  const values = new Map(stats.activity.map((day) => [day.date, day.steps]))
  const levels = [...new Set(stats.activity.map((day) => day.steps).filter((steps) => steps > 0))].sort((a, b) => a - b)
  const weeks = Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = start + week * 7 + day
      const key = new Date(date * 86_400_000).toISOString().slice(0, 10)
      const steps = values.get(key) ?? 0
      return {
        date: key,
        steps,
        level:
          date < from || date > to
            ? -1
            : steps === 0
              ? 0
              : 1 + Math.min(3, Math.floor((levels.indexOf(steps) * 4) / levels.length)),
      }
    }),
  )
  const months = Array.from({ length: count * 2 }, () => " ")
  weeks.forEach((_, index) => {
    const date = new Date(Math.max(from, start + index * 7) * 86_400_000)
    const previous = new Date(Math.max(from, start + (index - 1) * 7) * 86_400_000)
    if (index !== 0 && date.getUTCMonth() === previous.getUTCMonth()) return
    if (index === 0 && count > 1 && new Date((start + 7) * 86_400_000).getUTCMonth() !== date.getUTCMonth()) return
    const label = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    if (index * 2 + label.length > months.length) return
    Array.from(label).forEach((char, offset) => {
      months[index * 2 + offset] = char
    })
  })
  return { weeks, months: months.join(""), clipped: count < total }
}
