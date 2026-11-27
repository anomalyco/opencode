import { createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

/** Dollar amounts and reset times as the usage surfaces write them. */
export function useUsageFormat() {
  const language = useLanguage()

  // Built once per locale: the model picker formats a budget for every row, and a formatter is slow to construct.
  const formats = createMemo(() => {
    const locale = language.intl()
    const money = { style: "currency", currency: "USD", maximumFractionDigits: 2 } as const

    return {
      cents: new Intl.NumberFormat(locale, { ...money, minimumFractionDigits: 2 }),
      whole: new Intl.NumberFormat(locale, { ...money, minimumFractionDigits: 0 }),
      date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
      time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }),
      zone: new Intl.DateTimeFormat(locale, { timeZoneName: "shortOffset" }),
      short: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    }
  })

  return {
    /** `auto` drops the cents of a whole amount, the way limits are set. */
    money: (value: number, cents: "always" | "auto" = "always") =>
      (cents === "auto" && Number.isInteger(value) ? formats().whole : formats().cents).format(value),
    time: (at: number) =>
      language.t("usage.time", {
        date: formats().date.format(at),
        time: formats().time.format(at),
        zone:
          formats()
            .zone.formatToParts(at)
            .find((part) => part.type === "timeZoneName")?.value ?? "",
      }),
    /** How long until a reset, to the minute. */
    duration: (until: number) => {
      const minutes = Math.max(1, Math.floor((until - Date.now()) / 60_000))

      if (minutes >= 1_440)
        return language.t("usage.duration.days", {
          days: Math.floor(minutes / 1_440),
          hours: Math.floor((minutes % 1_440) / 60),
        })

      if (minutes >= 60)
        return language.t("usage.duration.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })

      return language.t("usage.duration.minutes", { minutes })
    },
    /** A reset time within the next day, as a time of day alone. */
    clock: (at: number) => (at - Date.now() < 86_400_000 ? formats().time : formats().short).format(at),
    /** A reset time where there is no room for its time zone. */
    shortTime: (at: number) => formats().short.format(at),
  }
}
