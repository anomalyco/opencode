import { displaySlice, promptOffsetWidth } from "../prompt/display"

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

// Longest prefix that fits the column budget; never splits a grapheme (emoji, CJK).
function fitWidth(str: string, budget: number) {
  let width = 0
  for (const part of graphemes.segment(str)) {
    const next = width + (part.segment === "\n" ? 1 : Bun.stringWidth(part.segment))
    if (next > budget) return str.slice(0, part.index)
    width = next
  }
  return str
}

export function truncate(str: string, len: number): string {
  if (promptOffsetWidth(str) <= len) return str
  return fitWidth(str, len - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  const width = promptOffsetWidth(str)
  if (width <= len) return str
  return "…" + displaySlice(str, width - (len - 1))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  const width = promptOffsetWidth(str)
  if (width <= maxLength) return str

  const keepStart = Math.ceil((maxLength - 1) / 2)
  const keepEnd = Math.floor((maxLength - 1) / 2)

  return displaySlice(str, 0, keepStart) + "…" + displaySlice(str, width - keepEnd)
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
