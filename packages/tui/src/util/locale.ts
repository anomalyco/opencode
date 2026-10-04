import { stringWidth } from "./string-width"

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

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

/**
 * Renders a USD amount.
 * Amounts of at least one cent keep two decimals.
 * Smaller amounts collapse to one truncated (never rounded-up) significant digit, since
 * sub-cent steps are dominated by noise.
 * `undefined` renders as an em dash; non-positive or non-finite values render as `$0.00`.
 */
export function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "—"
  if (!(cost > 0)) return "$0.00"
  if (cost >= 0.01) return `$${cost.toFixed(2)}`
  const decimals = Math.floor(-Math.log10(cost)) + 1
  const factor = 10 ** decimals
  // Truncate toward zero so a step never reads as costing more than it did.
  return `$${(Math.trunc(cost * factor) / factor).toFixed(decimals).replace(/0+$/, "")}`
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
  if (str.length <= len) return str
  return str.slice(0, len - 1) + "…"
}

/** Center `text` within `width` columns, biasing the extra padding right. */
export function padCenter(text: string, width: number) {
  const padding = Math.max(0, width - text.length)
  const left = Math.floor(padding / 2)
  return " ".repeat(left) + text + " ".repeat(padding - left)
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
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

export * as Locale from "./locale"
