import { createLanguage } from "../../i18n/translate"
import type { SessionStatsInfo } from "@opencode/client"
import { TokenUsage } from "@opencode/schema/token-usage"

export function statsMetrics(stats: SessionStatsInfo, language = createLanguage(() => "en")) {
  return [
    {
      label: language.t("tui.stats.tokenMetric"),
      value: TokenUsage.total(stats.tokens),
    },
    { label: language.t("tui.stats.bestStreak"), value: stats.streak },
    { label: language.t("tui.stats.activeDays"), value: stats.activeDays },
    { label: language.t("tui.stats.sessions"), value: stats.sessions },
  ]
}

export function statsNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}
