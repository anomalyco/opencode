import { tag, type Locale } from "./language"

export function formatTokens(value: number) {
  if (value >= 1_000_000_000_000) return `${trim(value / 1_000_000_000_000, value >= 10_000_000_000_000 ? 0 : 1)}T`
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000, value >= 10_000_000_000 ? 0 : 1)}B`
  if (value >= 1_000_000) return `${trim(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${trim(value / 1_000, value >= 10_000 ? 0 : 1)}K`
  return String(Math.round(value))
}

export function formatPercent(value: number) {
  return `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%`
}

export function formatPrice(value: number) {
  return `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`
}

export function formatLongDate(locale: Locale, value: string) {
  return new Intl.DateTimeFormat(tag(locale), {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value))
}

// New models report zero usage until they launch; start daily tables at the first day with usage.
export function fromFirstUsage<T extends { tokens: number }>(points: T[]) {
  const start = points.findIndex((point) => point.tokens > 0)
  return start < 0 ? [] : points.slice(start)
}

// Stats series label days like "Aug 7"; resolve the year from the latest update so dates stay correct across New Year.
export function isoDay(label: string, updatedAt: string | null) {
  const match = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})$/.exec(label.trim())
  const month = match ? months.indexOf(match[1].toLowerCase()) : -1
  if (!match || month < 0) return label
  const end = updatedAt ? new Date(updatedAt) : new Date()
  const date = new Date(Date.UTC(end.getUTCFullYear(), month, Number(match[2])))
  if (date.getTime() > end.getTime() + 86_400_000) date.setUTCFullYear(date.getUTCFullYear() - 1)
  return date.toISOString().slice(0, 10)
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function trim(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}
