import type { AutomationInfo } from "@opencode/client/promise"
import { Cron, Result } from "effect"
import type { useLanguage } from "@/runtime/i18n/language"

type Language = ReturnType<typeof useLanguage>

export function triggerLabel(row: AutomationInfo, language: Language) {
  const trigger = row.trigger

  switch (trigger.type) {
    case "at":
      return language.t("automations.trigger.at", { date: wallClock(trigger.at, row, language) })
    case "every":
      return language.t("automations.trigger.every", { interval: trigger.every.replace(/^1 /, "") })
    case "cron":
      return describeCron(trigger.cron, language) ?? trigger.cron
    case "event":
      return language.t("automations.trigger.event", { event: trigger.event, server: trigger.server })
  }
}

// Covers the shapes people ask for ("every weekday at 9"). Anything else keeps its cron text.
function describeCron(cron: string, language: Language) {
  const parsed = Cron.parse(cron)

  if (Result.isFailure(parsed)) return
  const minutes = [...parsed.success.minutes]
  const hours = [...parsed.success.hours]
  const weekdays = [...parsed.success.weekdays].toSorted((a, b) => a - b)

  if (parsed.success.days.size || parsed.success.months.size) return

  if (minutes.length === 1 && hours.length === 1) {
    const time = new Intl.DateTimeFormat(language.intl(), {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(Date.UTC(2000, 0, 1, hours[0], minutes[0]))

    if (!weekdays.length) return language.t("automations.trigger.daily", { time })

    if (weekdays.join() === "1,2,3,4,5") return language.t("automations.trigger.weekdays", { time })

    if (weekdays.join() === "0,6") return language.t("automations.trigger.weekends", { time })

    const day = new Intl.DateTimeFormat(language.intl(), { weekday: "long", timeZone: "UTC" })
    // 2 January 2000 was a Sunday, cron's day 0.
    const days = new Intl.ListFormat(language.intl()).format(weekdays.map((d) => day.format(Date.UTC(2000, 0, 2 + d))))

    return language.t("automations.trigger.days", { days, time })
  }

  if (weekdays.length) return

  if (hours.length) {
    const step = hours[1]! - hours[0]!

    // Evenly spaced across the whole day; `0 9-17 * * *` keeps its cron text.
    if (
      minutes.length !== 1 ||
      hours.length < 2 ||
      hours.length * step !== 24 ||
      !hours.every((hour, index) => hour === hours[0]! + index * step)
    )
      return

    const minute = String(minutes[0]).padStart(2, "0")

    if (step === 1) return language.t("automations.trigger.hourly", { minute })

    return language.t("automations.trigger.hours", { count: step, minute })
  }

  if (minutes.length === 1)
    return language.t("automations.trigger.hourly", { minute: String(minutes[0]).padStart(2, "0") })

  const step = minutes[1]! - minutes[0]!

  if (minutes[0] === 0 && 60 % step === 0 && minutes.every((minute, index) => minute === index * step))
    return language.t("automations.trigger.minutes", { count: step })
}

function wallClock(at: string, row: AutomationInfo, language: Language) {
  if (row.nextDueAt) return formatDate(row.nextDueAt, row.tz, language)

  // A wall-clock time without an offset is already in the automation's zone, so show it as written.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(at)) return formatDate(Date.parse(`${at}Z`), "UTC", language)

  const instant = Date.parse(at)

  return Number.isNaN(instant) ? at : formatDate(instant, row.tz, language)
}

export function formatDate(at: number, timeZone: string, language: Language) {
  return new Date(at).toLocaleString(language.intl(), { dateStyle: "medium", timeStyle: "short", timeZone })
}

export function relativeTime(at: number, language: Language) {
  const format = new Intl.RelativeTimeFormat(language.intl(), { numeric: "auto" })
  const seconds = (at - Date.now()) / 1000
  const minutes = seconds / 60
  const hours = minutes / 60

  if (Math.abs(seconds) < 60) return format.format(0, "second")

  if (Math.abs(minutes) < 60) return format.format(Math.round(minutes), "minute")

  if (Math.abs(hours) < 24) return format.format(Math.round(hours), "hour")

  return format.format(Math.round(hours / 24), "day")
}

// "5m", "2h", "3d": how long until the next run, for the list's chip.
export function shortDuration(at: number, language: Language) {
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60_000))

  const [value, unit] =
    minutes < 60
      ? [minutes, "minute"]
      : minutes < 1440
        ? [Math.round(minutes / 60), "hour"]
        : [Math.round(minutes / 1440), "day"]

  return new Intl.NumberFormat(language.intl(), { style: "unit", unit, unitDisplay: "narrow" }).format(value)
}

export function statusLabel(row: AutomationInfo, t: Language["t"]) {
  if (row.status === "paused" && row.lastOutcome === "failed") return t("automations.status.failed")

  if (row.status === "done" && row.lastOutcome === "expired") return t("automations.status.expired")

  return t(`automations.status.${row.status}`)
}

const rank = { active: 0, paused: 1, done: 2 }

export function compareAutomations(a: AutomationInfo, b: AutomationInfo) {
  return (
    rank[a.status] - rank[b.status] ||
    (a.status === "active" ? (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity) : 0) ||
    b.time.updated - a.time.updated
  )
}
