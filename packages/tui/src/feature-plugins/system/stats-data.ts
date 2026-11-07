import type { SessionStatsInfo } from "@Mackery6969/client"
import { TokenUsage } from "@Mackery6969/schema/token-usage"

export function statsMetrics(stats: SessionStatsInfo) {
  return [
    {
      label: "tokens",
      value: TokenUsage.total(stats.tokens),
    },
    { label: "best streak", value: stats.streak },
    { label: "active days", value: stats.activeDays },
    { label: "sessions", value: stats.sessions },
  ]
}

export function statsNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}
