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

// A chart bar's dates, both inclusive: "Nov 9, 2026" for one day, "Nov 9 – 15, 2026" for a week.
export function formatPeriodDate(start: string, end: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(new Date(start), new Date(end))
}

function trim(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en")
}
