export function getWeekBounds(date: Date) {
  const offset = (date.getUTCDay() + 6) % 7
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - offset)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}
