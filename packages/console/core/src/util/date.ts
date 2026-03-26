export function getWeekBounds(date: Date) {
  const offset = (date.getUTCDay() + 6) % 7
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - offset)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}

export function getMonthlyBounds(now: Date, subscribed: Date) {
  const day = subscribed.getUTCDate()
  const hh = subscribed.getUTCHours()
  const mm = subscribed.getUTCMinutes()
  const ss = subscribed.getUTCSeconds()
  const ms = subscribed.getUTCMilliseconds()

  function anchor(year: number, month: number) {
    const max = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return new Date(Date.UTC(year, month, Math.min(day, max), hh, mm, ss, ms))
  }

  function shift(year: number, month: number, delta: number) {
    const total = year * 12 + month + delta
    return [Math.floor(total / 12), ((total % 12) + 12) % 12] as const
  }

  let y = now.getUTCFullYear()
  let m = now.getUTCMonth()
  let start = anchor(y, m)
  if (start > now) {
    ;[y, m] = shift(y, m, -1)
    start = anchor(y, m)
  }
  const [ny, nm] = shift(y, m, 1)
  const end = anchor(ny, nm)
  return { start, end }
}
