import { DateTime } from "luxon"

export function createPerformanceFormatter(locale: string) {
  return {
    duration(value: number | undefined) {
      if (value === undefined) return "—"
      if (value < 1000)
        return new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", maximumFractionDigits: 0 }).format(value)
      if (value < 60_000)
        return new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 1 }).format(value / 1000)
      return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", maximumFractionDigits: 1 }).format(value / 60_000)
    },
    clock(value: number | undefined) {
      if (!value) return "—"
      return DateTime.fromMillis(value).setLocale(locale).toLocaleString(DateTime.TIME_WITH_SECONDS)
    },
  }
}
