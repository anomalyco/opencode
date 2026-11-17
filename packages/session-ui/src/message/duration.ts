import type { UiI18nSource } from "@opencode/ui/context/i18n"

/** A whole number of seconds as `12s`, `4m 5s` or `2h 5m`, with the digits in the reader's locale. */
export function formatDuration(seconds: number, i18n: Pick<UiI18nSource, "locale" | "t">) {
  const total = Math.max(0, Math.floor(seconds))
  const numfmt = new Intl.NumberFormat(i18n.locale())

  if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

  if (total < 3600)
    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })

  return i18n.t("ui.message.duration.hoursMinutes", {
    hours: numfmt.format(Math.floor(total / 3600)),
    minutes: numfmt.format(Math.floor(total / 60) % 60),
  })
}
