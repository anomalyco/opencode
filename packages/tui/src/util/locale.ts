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

function graphemeParts(str: string) {
  return Array.from(graphemes.segment(str), (part) => part.segment)
}

function graphemeWidth(parts: string[]) {
  return parts.reduce((sum, part) => sum + Bun.stringWidth(part), 0)
}

function takeWidth(parts: string[], budget: number) {
  const kept: string[] = []
  let width = 0
  for (const part of parts) {
    const next = width + Bun.stringWidth(part)
    if (next > budget) break
    kept.push(part)
    width = next
  }
  return kept
}

export function truncate(str: string, len: number): string {
  const parts = graphemeParts(str)
  if (graphemeWidth(parts) <= len) return str
  return takeWidth(parts, Math.max(0, len - 1)).join("") + "…"
}

export function truncateLeft(str: string, len: number): string {
  const parts = graphemeParts(str)
  if (graphemeWidth(parts) <= len) return str
  return "…" + takeWidth(parts.reverse(), Math.max(0, len - 1)).reverse().join("")
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  const parts = graphemeParts(str)
  if (graphemeWidth(parts) <= maxLength) return str

  const keep = Math.max(0, maxLength - 1)
  const start = takeWidth(parts, Math.ceil(keep / 2)).join("")
  const end = takeWidth([...parts].reverse(), Math.floor(keep / 2))
    .reverse()
    .join("")
  return start + "…" + end
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
