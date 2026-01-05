import type { RGBA } from "@opentui/core"

export function getUsageColor(percent: number, theme: { error: RGBA; warning: RGBA; success: RGBA }): RGBA {
  if (percent >= 90) return theme.error
  if (percent >= 70) return theme.warning
  return theme.success
}

export function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent))
}

export function usageBarString(percent: number, width: number = 10): string {
  const clamped = clampPercent(percent)
  const filled = Math.round((clamped / 100) * width)
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled)
}
