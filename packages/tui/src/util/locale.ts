export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(input: number): string {
  const date = new Date(input)
  const localTime = time(input)
  const localDate = date.toLocaleDateString()
  return `${localTime} · ${localDate}`
}

export function todayTimeOrDateTime(input: number): string {
  const date = new Date(input)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()

  if (isToday) {
    return time(input)
  } else {
    return datetime(input)
  }
}

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

export function duration(input: number) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Keep the existing UTF-16 length budget, but discard a whole grapheme if it does not fit.
export function truncate(str: string, len: number): string {
  if (len <= 0) return ""
  if (str.length <= len) return str
  return takeGraphemePrefix(str, len - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (len <= 0) return ""
  if (str.length <= len) return str
  return "…" + takeGraphemeSuffix(str, len - 1)
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (maxLength <= 0) return ""
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

  return takeGraphemePrefix(str, keepStart) + ellipsis + takeGraphemeSuffix(str, keepEnd)
}

function takeGraphemePrefix(str: string, budget: number) {
  if (budget <= 0) return ""
  for (const part of graphemes.segment(str)) {
    if (part.index + part.segment.length > budget) return str.slice(0, part.index)
  }
  return str
}

function takeGraphemeSuffix(str: string, budget: number) {
  if (budget <= 0) return ""
  const start = str.length - budget
  for (const part of graphemes.segment(str)) {
    if (part.index >= start) return str.slice(part.index)
  }
  return ""
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
