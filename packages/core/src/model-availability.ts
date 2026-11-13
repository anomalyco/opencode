export * as ModelAvailability from "./model-availability.js"

import { Context, Effect, Layer, Schema } from "effect"
import { Model } from "@opencode/schema/model"

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const MINUTES_PER_DAY = 24 * 60

function parseTime(value: string): number {
  const [hours, minutes] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

// Formatters are expensive; cache one per configured timezone (bounded by config variety).
const formatters = new Map<string, Intl.DateTimeFormat>()
const formatter = (timezone: string) => {
  let value = formatters.get(timezone)
  if (value === undefined) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    })
    formatters.set(timezone, value)
  }
  return value
}

/** Minutes since local midnight and day of week; throws on an unknown timezone. */
function localMinutes(date: Date, timezone: string): { readonly minutes: number; readonly day: number } {
  const parts = formatter(timezone).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0")
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "").toLowerCase()
  const day = DAYS.indexOf(weekday as (typeof DAYS)[number])
  if (day === -1) throw new Error(`unrecognized weekday ${weekday}`)
  return { minutes: hour * 60 + minute, day }
}

function windowMatches(
  window: Model.Availability["windows"][number],
  local: { readonly minutes: number; readonly day: number },
): boolean {
  const start = parseTime(window.start)
  const end = parseTime(window.end)
  const wraps = start > end
  // A window that wraps midnight also covers the early hours of the next day, so measure
  // minutes from the window's own start-of-day reference point.
  const offset = wraps && local.minutes < start ? local.minutes + MINUTES_PER_DAY : local.minutes
  if (start <= end) return offset >= start && offset <= end
  return offset >= start && offset <= end + MINUTES_PER_DAY
}

function matchesDay(
  window: Model.Availability["windows"][number],
  local: { readonly minutes: number; readonly day: number },
): boolean {
  const start = parseTime(window.start)
  // The wrapped tail (minutes below the window start) belongs to the previous day.
  const day = start > parseTime(window.end) && local.minutes < start ? (local.day + 6) % 7 : local.day
  return window.days === undefined || window.days.includes(DAYS[day])
}

/** Wall clock for availability evaluation; defaults to the real clock, tests provide a fixed instant. */
export interface Now {
  readonly now: () => Date
}
export class Now extends Context.Service<Now, Now>()("@opencode/ModelAvailability/Now") {
  static readonly at = (date: Date) => Layer.succeed(Now, { now: () => date } as Now)
}

const now = Effect.serviceOption(Now).pipe(
  Effect.map((service) => (service._tag === "Some" ? service.value.now : () => new Date())),
)

/** Whether the model may be used at the current time; models without `availability` are always available. */
export const check = Effect.fn("ModelAvailability.check")(function* (info: Model.Info) {
  const availability = info.availability
  if (availability === undefined) return true
  const clock = yield* now
  const timezone = availability.timezone ?? "UTC"
  const local = yield* Effect.try({
    try: () => localMinutes(clock(), timezone),
    catch: (cause) =>
      new TimezoneError({
        timezone,
        providerID: info.providerID,
        modelID: info.id,
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
  })
  const within = availability.windows.some((window) => windowMatches(window, local) && matchesDay(window, local))
  return availability.mode === "allow" ? within : !within
})

export class TimezoneError extends Schema.TaggedError<TimezoneError>()(
  "ModelAvailability.TimezoneError",
  {
    timezone: Schema.String,
    providerID: Schema.String,
    modelID: Schema.String,
    cause: Schema.String,
  },
) {
  override get message() {
    return `Invalid timezone for ${this.providerID}/${this.modelID}: ${this.timezone}`
  }
}
