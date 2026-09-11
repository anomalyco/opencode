import { DateTime } from "luxon"

export function createSessionContextFormatter(locale: string) {
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" })

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
    cost(value: number) {
      return currency.format(value)
    },
    tokens(total: number) {
      if (total < 1000) return String(total)
      if (total < 1_000_000) return `${(total / 1000).toFixed(total < 10_000 ? 1 : 0)}k`
      return `${(total / 1_000_000).toFixed(1)}M`
    },
  }
}
