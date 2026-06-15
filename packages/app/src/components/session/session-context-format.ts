import { DateTime } from "luxon"
import { CostDisplay } from "@opencode-ai/core/cost-display"

export function createSessionContextFormatter(locale: string, config?: CostDisplay.Config) {
  return {
    cost(value: number) {
      return CostDisplay.format(locale, value, config)
    },
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale) + "%"
    },
    time(value: number | undefined) {
      if (!value) return "—"
      return DateTime.fromMillis(value).setLocale(locale).toLocaleString(DateTime.DATETIME_MED)
    },
  }
}
