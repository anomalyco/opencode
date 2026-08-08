import { DateTime } from "luxon"
import { Currency } from "@opencode-ai/core/currency"

export function createSessionContextFormatter(locale: string) {
  return {
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
    cost(
      amount: number,
      source: string,
      display: { currency?: string; exchangeRates?: Record<string, number> } | undefined,
    ) {
      const target = display?.currency?.trim()
      if (!target) return Currency.format(amount, source, locale)
      const converted = Currency.convert(amount, source, target, display?.exchangeRates)
      if (converted === undefined) return Currency.format(amount, source, locale)
      return Currency.format(converted, target, locale)
    },
  }
}
