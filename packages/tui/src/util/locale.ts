import type { DateFormat } from "../config"
import { stringWidth } from "./string-width"

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad = (value: number) => String(value).padStart(2, "0")

export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function date(input: number, format: DateFormat = "locale"): string {
  const value = new Date(input)
  if (format === "locale") return value.toLocaleDateString()
  if (format === "friendly") return `${months[value.getMonth()]} ${value.getDate()}, ${value.getFullYear()}`
  if (format === "iso") return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  return `${pad(value.getDate())}-${months[value.getMonth()]}-${value.getFullYear()}`
}

export function datetime(input: number, format: DateFormat = "locale"): string {
  return `${time(input)} · ${date(input, format)}`
}

export function number(num: number): string {
  // 999950+ would round to "1000.0K"
  if (num >= 999950) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

export { duration } from "@opencode/util/duration"

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function graphemes(str: string) {
  return Array.from(graphemeSegmenter.segment(str), (item) => item.segment)
}

export function takeWidth(str: string, width: number) {
  if (width <= 0) return ""
  if (stringWidth(str) <= width) return str

  const result: string[] = []
  let used = 0
  for (const segment of graphemes(str)) {
    const next = stringWidth(segment)
    if (used + next > width) break
    result.push(segment)
    used += next
  }
  return result.join("")
}

export function truncateWidth(str: string, width: number): string {
  if (width <= 0) return ""
  if (stringWidth(str) <= width) return str
  if (width === 1) return "…"
  return takeWidth(str, width - 1) + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (str.length <= len) return str
  return "…" + str.slice(-(len - 1))
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (maxLength <= 0) return ""
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)
  if (keepEnd <= 0) return str.slice(0, keepStart) + ellipsis

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

export * as Locale from "./locale"
