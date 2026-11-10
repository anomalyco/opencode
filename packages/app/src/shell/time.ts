type TimeKey =
  | "common.time.justNow"
  | "common.time.minutesAgo.short"
  | "common.time.hoursAgo.short"
  | "common.time.daysAgo.short"

type Translate = (key: TimeKey, params?: Record<string, string | number>) => string

export function getRelativeTime(dateString: string, t: Translate, locale: string, now = Date.now()): string {
  const date = new Date(dateString)
  const current = new Date(now)
  const diffMs = now - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return t("common.time.justNow")

  if (diffMinutes < 60) return t("common.time.minutesAgo.short", { count: diffMinutes })

  if (diffHours < 24) return t("common.time.hoursAgo.short", { count: diffHours })

  if (diffDays < 7) return t("common.time.daysAgo.short", { count: diffDays })

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === current.getFullYear() ? undefined : "numeric",
  }).format(date)
}
