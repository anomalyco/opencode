import type { TuiConfig } from "@/cli/cmd/tui/config/tui"

export type TimestampsMode = "hide" | "footer" | "gutter"

export const TIMESTAMPS_MODES: readonly TimestampsMode[] = ["hide", "footer", "gutter"] as const

export function getTimestampsMode(tuiConfig?: Pick<TuiConfig.Info, "timestamps_mode">): TimestampsMode {
  return tuiConfig?.timestamps_mode ?? "hide"
}

// Cycles in display-priority order so the slash command feels predictable:
// hide → footer → gutter → hide.
export function nextTimestampsMode(current: TimestampsMode): TimestampsMode {
  const i = TIMESTAMPS_MODES.indexOf(current)
  return TIMESTAMPS_MODES[(i + 1) % TIMESTAMPS_MODES.length]
}

// Normalize legacy KV values: an existing user toggled "show" before this
// change shipped — preserve their intent by mapping it to "footer".
export function normalizeTimestampsMode(value: unknown, fallback: TimestampsMode): TimestampsMode {
  if (value === "show") return "footer"
  if (value === "hide" || value === "footer" || value === "gutter") return value
  return fallback
}

// Fixed 5-cell "HH:MM" in the user's local timezone, 24-hour. Locale-independent
// so the gutter column stays aligned across en-US (12h) and en-GB (24h) users.
export function hourMinute(input: number): string {
  const date = new Date(input)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}
