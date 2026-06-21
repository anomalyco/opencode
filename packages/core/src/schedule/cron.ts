export function parseCronOrDuration(expression: string, fromDate = new Date()): Date {
  const durationMatch = expression.trim().match(/^(\d+)([mhdw])$/i)
  if (durationMatch) {
    const val = parseInt(durationMatch[1], 10)
    const unit = durationMatch[2].toLowerCase()
    const ms =
      unit === "m" ? val * 60 * 1000 :
      unit === "h" ? val * 60 * 60 * 1000 :
      unit === "d" ? val * 24 * 60 * 60 * 1000 :
      unit === "w" ? val * 7 * 24 * 60 * 60 * 1000 : 0
    return new Date(fromDate.getTime() + ms)
  }

  const fields = expression.trim().split(/\s+/)
  if (fields.length === 5) {
    const date = new Date(fromDate.getTime())
    date.setMinutes(date.getMinutes() + 1)
    date.setSeconds(0)
    date.setMilliseconds(0)

    const minField = fields[0]
    if (minField.startsWith("*/")) {
      const step = parseInt(minField.slice(2), 10) || 1
      const currentMin = date.getMinutes()
      const remainder = currentMin % step
      if (remainder !== 0) {
        date.setMinutes(currentMin + (step - remainder))
      }
      return date
    }

    // Standard minute match if it's a number
    if (/^\d+$/.test(minField)) {
      const targetMin = parseInt(minField, 10)
      if (date.getMinutes() > targetMin) {
        date.setHours(date.getHours() + 1)
      }
      date.setMinutes(targetMin)
      return date
    }

    return date
  }

  // Default: 1 minute from now
  return new Date(fromDate.getTime() + 60 * 1000)
}
