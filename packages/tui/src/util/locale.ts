const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const ellipsis = "…"

function truncateEnd(str: string, width: number) {
  let out = ""
  let current = 0
  for (const part of graphemes.segment(str)) {
    const next = current + Bun.stringWidth(part.segment)
    if (next > width) return out
    out += part.segment
    current = next
  }
  return out
}

function truncateStart(str: string, width: number) {
  let out = ""
  let current = 0
  for (const part of Array.from(graphemes.segment(str)).reverse()) {
    const next = current + Bun.stringWidth(part.segment)
    if (next > width) return out
    out = part.segment + out
    current = next
  }
  return out
}

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

export function truncate(str: string, len: number): string {
  if (Bun.stringWidth(str) <= len) return str
  if (len <= 0) return ""
  return truncateEnd(str, len - Bun.stringWidth(ellipsis)) + ellipsis
}

export function truncateLeft(str: string, len: number): string {
  if (Bun.stringWidth(str) <= len) return str
  if (len <= 0) return ""
  return ellipsis + truncateStart(str, len - Bun.stringWidth(ellipsis))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (Bun.stringWidth(str) <= maxLength) return str
  if (maxLength <= 0) return ""

  const budget = maxLength - Bun.stringWidth(ellipsis)
  const keepStart = Math.ceil(budget / 2)
  const keepEnd = Math.floor(budget / 2)

  return truncateEnd(str, keepStart) + ellipsis + truncateStart(str, keepEnd)
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
