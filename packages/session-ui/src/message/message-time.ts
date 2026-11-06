/**
 * Names a message's day relatively: Today and Yesterday, then the date this year, then the date with its year.
 * `bareToday` leaves today's time on its own, for places where an unqualified time already reads as today.
 */
export function messageTime(time: number, locale: string, options: { bareToday?: boolean } = {}) {
  const date = new Date(time)
  const now = new Date()
  const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000)
  const clock = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date)

  if (days === 0 && options.bareToday) return clock

  if (days === 0 || days === 1) {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")

    return `${day[0]?.toLocaleUpperCase(locale)}${day.slice(1)}, ${clock}`
  }

  if (date.getFullYear() === now.getFullYear())
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date)

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}
