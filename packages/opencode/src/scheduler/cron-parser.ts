export namespace CronParser {
  export interface CronExpr {
    minute: number[]
    hour: number[]
    dayOfMonth: number[]
    month: number[]
    dayOfWeek: number[]
  }

  const MINUTE_MAX = 59
  const HOUR_MAX = 23
  const DAY_OF_MONTH_MAX = 31
  const MONTH_MAX = 12
  const DAY_OF_WEEK_MAX = 6

  function parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>()

    const parts = field.split(",")
    for (const part of parts) {
      if (part.includes("/")) {
        const [range, stepStr] = part.split("/")
        const step = parseInt(stepStr, 10)
        if (isNaN(step) || step <= 0) {
          throw new Error(`Invalid step value: ${stepStr}`)
        }

        let start = min
        let end = max
        if (range !== "*") {
          const [startStr, endStr] = range.split("-")
          start = parseInt(startStr, 10)
          end = endStr ? parseInt(endStr, 10) : max
          if (isNaN(start) || isNaN(end)) {
            throw new Error(`Invalid range: ${range}`)
          }
        }

        for (let i = start; i <= end; i += step) {
          if (i >= min && i <= max) {
            values.add(i)
          }
        }
      } else if (part.includes("-")) {
        const [startStr, endStr] = part.split("-")
        const start = parseInt(startStr, 10)
        const end = parseInt(endStr, 10)
        if (isNaN(start) || isNaN(end)) {
          throw new Error(`Invalid range: ${part}`)
        }
        if (start < min || end > max || start > end) {
          throw new Error(`Range out of bounds: ${part}`)
        }
        for (let i = start; i <= end; i++) {
          values.add(i)
        }
      } else if (part === "*") {
        for (let i = min; i <= max; i++) {
          values.add(i)
        }
      } else {
        const value = parseInt(part, 10)
        if (isNaN(value)) {
          throw new Error(`Invalid value: ${part}`)
        }
        if (value < min || value > max) {
          throw new Error(`Value out of bounds: ${value}`)
        }
        values.add(value)
      }
    }

    return Array.from(values).sort((a, b) => a - b)
  }

  export function parse(expr: string): CronExpr {
    const fields = expr.trim().split(/\s+/)
    if (fields.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`)
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields

    return {
      minute: parseField(minute, 0, MINUTE_MAX),
      hour: parseField(hour, 0, HOUR_MAX),
      dayOfMonth: parseField(dayOfMonth, 1, DAY_OF_MONTH_MAX),
      month: parseField(month, 1, MONTH_MAX),
      dayOfWeek: parseField(dayOfWeek, 0, DAY_OF_WEEK_MAX),
    }
  }

  export function isValid(expr: string): boolean {
    try {
      parse(expr)
      return true
    } catch {
      return false
    }
  }

  export function nextRun(expr: CronExpr, after: number): number {
    const maxIterations = 366 * 24 * 60
    let iterations = 0

    let date = new Date(after)
    date.setSeconds(0, 0)
    date.setMinutes(date.getMinutes() + 1)

    while (iterations < maxIterations) {
      iterations++

      const month = date.getMonth() + 1
      if (!expr.month.includes(month)) {
        const currentMonth = month
        let found = false
        for (const m of expr.month) {
          if (m > currentMonth) {
            date.setMonth(m - 1)
            date.setDate(1)
            date.setHours(0, 0, 0, 0)
            found = true
            break
          }
        }
        if (!found) {
          date.setFullYear(date.getFullYear() + 1)
          date.setMonth(expr.month[0] - 1)
          date.setDate(1)
          date.setHours(0, 0, 0, 0)
        }
        continue
      }

      const dayOfMonth = date.getDate()
      const dayOfWeek = date.getDay()
      const dayMatches = expr.dayOfMonth.includes(dayOfMonth) || expr.dayOfWeek.includes(dayOfWeek)

      if (!dayMatches) {
        date.setDate(date.getDate() + 1)
        date.setHours(0, 0, 0, 0)
        continue
      }

      const hour = date.getHours()
      if (!expr.hour.includes(hour)) {
        const currentHour = hour
        let found = false
        for (const h of expr.hour) {
          if (h > currentHour) {
            date.setHours(h)
            date.setMinutes(0, 0, 0)
            found = true
            break
          }
        }
        if (!found) {
          date.setDate(date.getDate() + 1)
          date.setHours(0, 0, 0, 0)
        }
        continue
      }

      const minute = date.getMinutes()
      if (!expr.minute.includes(minute)) {
        date.setMinutes(minute + 1)
        continue
      }

      return date.getTime()
    }

    throw new Error("Could not find next run time within 1 year")
  }

  export function humanReadable(expr: string): string {
    const parsed = parse(expr)
    const fields = expr.trim().split(/\s+/)

    if (fields[0].startsWith("*/") && fields[1] === "*") {
      const step = parseInt(fields[0].split("/")[1], 10)
      return `every ${step} minutes`
    }

    if (fields[0] === "0" && fields[1].startsWith("*/") && fields[2] === "*") {
      const step = parseInt(fields[1].split("/")[1], 10)
      return `every ${step} hours`
    }

    if (
      parsed.minute.length === 1 &&
      parsed.hour.length === 1 &&
      parsed.dayOfMonth.length === 31 &&
      parsed.month.length === 12 &&
      parsed.dayOfWeek.length === 7
    ) {
      const hour = parsed.hour[0]
      const minute = parsed.minute[0]
      const ampm = hour >= 12 ? "PM" : "AM"
      const displayHour = hour % 12 || 12
      return `Daily at ${displayHour}:${minute.toString().padStart(2, "0")} ${ampm}`
    }

    return `Scheduled: ${expr}`
  }
}
