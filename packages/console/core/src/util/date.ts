export function getWeekBounds(date: Date) {
  const dayOfWeek = date.getUTCDay()
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - dayOfWeek + 1)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}
