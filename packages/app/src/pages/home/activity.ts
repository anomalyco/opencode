import { DateTime } from "luxon"

export const HOME_ACTIVITY_DAYS = 280
export const HOME_ACTIVITY_WEEKS = Math.floor(HOME_ACTIVITY_DAYS / 7)

export type HomeActivityRecord = {
  session: {
    time: {
      created: number
      updated?: number | null
    }
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: {
        read?: number
        write?: number
      }
    }
  }
}

type SampleSessionTokens = NonNullable<HomeActivityRecord["session"]["tokens"]>

const TOKEN_UNITS = [
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
]

export type HomeActivityDay = {
  key: string
  label: string
  count: number
  tokens: number
  value: number
  level: number
  column: number
  row: number
}

export type HomeActivityMonth = {
  key: string
  label: string
  column: number
  span: number
}

export type HomeActivity = {
  days: HomeActivityDay[]
  months: HomeActivityMonth[]
  weekCount: number
  metric: "tokens" | "sessions"
  totalTokens: number
  peakTokens: number
  longestTaskMs: number
  currentStreak: number
  longestStreak: number
  hasActivity: boolean
}

function tokenTotal(tokens: HomeActivityRecord["session"]["tokens"]) {
  if (!tokens) return 0
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0) +
    (tokens.cache?.write ?? 0)
  )
}

export function formatActivityTokenAmount(value: number, locale: string) {
  if (!Number.isFinite(value) || value <= 0) return "0"

  let unit = TOKEN_UNITS.find((item) => value >= item.value)
  if (!unit) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value))

  const index = TOKEN_UNITS.indexOf(unit)
  if (index > 0 && value / unit.value >= 999.5) unit = TOKEN_UNITS[index - 1]!

  const amount = value / unit.value
  const maximumFractionDigits = amount < 100 ? 1 : 0
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount)
  return `${formatted}${unit.suffix}`
}

function sampleTokens(dayIndex: number, pulse: number): SampleSessionTokens {
  const total = Math.round(800 + pulse * 240 + (dayIndex % 5) * 180)
  return {
    input: Math.round(total * 0.52),
    output: Math.round(total * 0.22),
    reasoning: Math.round(total * 0.16),
    cache: {
      read: Math.round(total * 0.08),
      write: Math.round(total * 0.02),
    },
  }
}

function sampleActivityRecords(now: DateTime): HomeActivityRecord[] {
  const today = now.startOf("day")
  const start = today.minus({ days: HOME_ACTIVITY_DAYS - 1 })

  return Array.from({ length: HOME_ACTIVITY_DAYS }).flatMap((_, index) => {
    const wave = Math.sin(index / 11) + Math.cos(index / 23)
    const recentBoost = index > HOME_ACTIVITY_DAYS - 42 ? 1.8 : 0
    const pulse = Math.max(0, wave + recentBoost + ((index + 3) % 17 === 0 ? 1.6 : 0))
    const sessions = pulse < 0.5 ? 0 : Math.min(3, Math.ceil(pulse))
    const date = start.plus({ days: index, hours: 9 })

    return Array.from({ length: sessions }, (_, sessionIndex) => {
      const created = date.plus({ hours: sessionIndex * 2 }).toMillis()
      return {
        session: {
          time: {
            created,
            updated: created + (20 + sessionIndex * 17 + (index % 9) * 4) * 60_000,
          },
          tokens: sampleTokens(index, pulse + sessionIndex),
        },
      }
    })
  })
}

function dayKey(date: DateTime) {
  return date.toISODate() ?? String(date.toMillis())
}

function buildMonthLabels(days: Array<HomeActivityDay & { date: DateTime }>): HomeActivityMonth[] {
  const starts = days.flatMap((day, index) => {
    if (index !== 0 && day.date.day !== 1) return []
    return {
      key: `${day.key}-${day.date.month}`,
      label: day.date.toLocaleString({ month: "short" }),
      column: day.column,
    }
  })

  return starts.map((month, index) => {
    const next = starts[index + 1]
    return {
      ...month,
      span: Math.max(1, (next?.column ?? HOME_ACTIVITY_WEEKS + 1) - month.column),
    }
  })
}

function longestStreak(days: HomeActivityDay[]) {
  let current = 0
  let longest = 0

  for (const day of days) {
    if (day.value > 0) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }

  return longest
}

function currentStreak(days: HomeActivityDay[]) {
  let streak = 0
  for (let index = days.length - 1; index >= 0; index--) {
    const day = days[index]
    if (!day || day.value === 0) break
    streak += 1
  }
  return streak
}

export function buildHomeActivity(
  records: HomeActivityRecord[],
  locale: string,
  now: DateTime = DateTime.local(),
): HomeActivity {
  const localNow = now.setLocale(locale)
  const sourceRecords = import.meta.env.DEV && records.length === 0 ? sampleActivityRecords(localNow) : records
  const today = localNow.startOf("day")
  const start = today.minus({ days: HOME_ACTIVITY_DAYS - 1 })

  const daysWithDate = Array.from({ length: HOME_ACTIVITY_DAYS }, (_, index) => {
    const date = start.plus({ days: index })
    return {
      key: dayKey(date),
      label: date.toLocaleString({ month: "short", day: "numeric" }),
      count: 0,
      tokens: 0,
      value: 0,
      level: 0,
      column: Math.floor(index / 7) + 1,
      row: (index % 7) + 1,
      date,
    }
  })

  const byKey = new Map(daysWithDate.map((day) => [day.key, day]))
  const startMillis = start.toMillis()
  const todayMillis = today.toMillis()
  let longestTaskMs = 0

  for (const record of sourceRecords) {
    const created = record.session.time.created
    const updated = record.session.time.updated ?? created
    if (!Number.isFinite(created)) continue

    if (Number.isFinite(created) && Number.isFinite(updated) && updated > created) {
      longestTaskMs = Math.max(longestTaskMs, updated - created)
    }

    const day = DateTime.fromMillis(updated, { zone: localNow.zone }).setLocale(locale).startOf("day")
    const dayMillis = day.toMillis()
    if (dayMillis < startMillis || dayMillis > todayMillis) continue

    const bucket = byKey.get(dayKey(day))
    if (!bucket) continue
    bucket.count += 1
    bucket.tokens += tokenTotal(record.session.tokens)
  }

  const totalTokens = daysWithDate.reduce((sum, day) => sum + day.tokens, 0)
  const peakTokens = daysWithDate.reduce((highest, day) => Math.max(highest, day.tokens), 0)
  const peakCount = daysWithDate.reduce((highest, day) => Math.max(highest, day.count), 0)
  const metric: "tokens" | "sessions" = peakTokens > 0 ? "tokens" : "sessions"
  const maxValue = metric === "tokens" ? peakTokens : peakCount
  const days = daysWithDate.map(({ date: _date, ...day }) => {
    const value = metric === "tokens" ? day.tokens : day.count
    const level = maxValue === 0 || value === 0 ? 0 : Math.max(1, Math.ceil((value / maxValue) * 4))
    return {
      ...day,
      value,
      level,
    }
  })

  return {
    days,
    months: buildMonthLabels(daysWithDate),
    weekCount: HOME_ACTIVITY_WEEKS,
    metric,
    totalTokens,
    peakTokens,
    longestTaskMs,
    currentStreak: currentStreak(days),
    longestStreak: longestStreak(days),
    hasActivity: days.some((day) => day.value > 0),
  }
}
