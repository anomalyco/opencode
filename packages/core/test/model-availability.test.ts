import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Model } from "@opencode/schema/model"
import { ModelAvailability } from "@opencode/core/model-availability"
import { Provider } from "@opencode/core/provider"
import { it } from "./lib/effect"

const UTC = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 8 + day, hour, minute))
// 2026-11-08 is a Sunday; day 0 = Sunday, day 1 = Monday.

function model(availability: Model.Availability | undefined) {
  return {
    ...Model.Info.default(Provider.ID.make("test-provider"), Model.ID.make("test-model")),
    availability,
  }
}

const blocked = (availability: Model.Availability, at: Date) =>
  ModelAvailability.check(model(availability)).pipe(
    Effect.provide(ModelAvailability.Now.at(at)),
    Effect.map((available) => !available),
  )

describe("ModelAvailability.check", () => {
  it.effect("allows any time without availability config", () =>
    Effect.gen(function* () {
      expect(
        yield* ModelAvailability.check(model(undefined)).pipe(Effect.provide(ModelAvailability.Now.at(UTC(1, 2)))),
      ).toBe(true)
    }),
  )

  it.effect("blocks within a block window on listed days, [start, end) boundaries", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "01:00", end: "04:00" }],
      }
      // Monday 01:00 UTC — the inclusive start.
      expect(yield* blocked(availability, UTC(1, 1, 0))).toBe(true)
      // Monday 03:59:59 UTC, the last second before the end.
      expect(yield* blocked(availability, new Date(Date.UTC(2026, 10, 9, 3, 59, 59)))).toBe(true)
      // Monday 04:00:00 UTC — the exclusive end.
      expect(yield* blocked(availability, UTC(1, 4, 0))).toBe(false)
      // Monday 04:00:30 UTC — 30 seconds into the end minute, still outside.
      expect(yield* blocked(availability, new Date(Date.UTC(2026, 10, 9, 4, 0, 30)))).toBe(false)
      // Monday 00:59 UTC — just before the window.
      expect(yield* blocked(availability, UTC(1, 0, 59))).toBe(false)
      // Saturday 02:00 UTC — the window lists weekdays only.
      expect(yield* blocked(availability, UTC(6, 2, 0))).toBe(false)
    }),
  )

  it.effect("blocks both DeepSeek peak windows independently", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [
          { days: ["mon", "tue", "wed", "thu", "fri"], start: "01:00", end: "04:00" },
          { days: ["mon", "tue", "wed", "thu", "fri"], start: "06:00", end: "10:00" },
        ],
      }
      expect(yield* blocked(availability, UTC(1, 2, 30))).toBe(true)
      expect(yield* blocked(availability, UTC(1, 8, 0))).toBe(true)
      // Between the peaks.
      expect(yield* blocked(availability, UTC(1, 5, 0))).toBe(false)
      // After the second peak, at the exclusive end itself.
      expect(yield* blocked(availability, UTC(1, 10, 0))).toBe(false)
      // Well after the second peak.
      expect(yield* blocked(availability, UTC(1, 10, 1))).toBe(false)
    }),
  )

  it.effect("treats windows as the only allowed times in allow mode", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        mode: "allow",
        windows: [{ start: "22:00", end: "06:00" }],
      }
      // Monday 03:00 — inside the overnight window.
      expect(yield* blocked(availability, UTC(1, 3, 0))).toBe(false)
      // Monday 23:59 — inside the window that started Monday evening.
      expect(yield* blocked(availability, UTC(1, 23, 59))).toBe(false)
      // Monday noon — outside.
      expect(yield* blocked(availability, UTC(1, 12, 0))).toBe(true)
      expect(yield* blocked(availability, UTC(1, 22, 0))).toBe(false)
      expect(yield* blocked(availability, UTC(1, 6, 0))).toBe(true)
    }),
  )

  it.effect("supports a window that wraps midnight across the week boundary", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [{ days: ["sat"], start: "22:00", end: "04:00" }],
      }
      // Saturday night continues into Sunday, using Saturday's day filter.
      expect(yield* blocked(availability, UTC(6, 22, 0))).toBe(true)
      expect(yield* blocked(availability, UTC(7, 3, 59))).toBe(true)
      expect(yield* blocked(availability, UTC(7, 4, 0))).toBe(false)
      expect(yield* blocked(availability, UTC(7, 5, 0))).toBe(false)
      expect(yield* blocked(availability, UTC(5, 23, 0))).toBe(false)
    }),
  )

  it.effect("does not extend a wrapping window into an unlisted head day", () =>
    Effect.gen(function* () {
      // Only the head day (Friday) is listed; the tail after midnight belongs to Friday.
      const availability: Model.Availability = {
        windows: [{ days: ["fri"], start: "22:00", end: "04:00" }],
      }
      // Friday 23:00 — head day, inside.
      expect(yield* blocked(availability, UTC(5, 23, 0))).toBe(true)
      // Friday 04:30 — head day, before the window starts.
      expect(yield* blocked(availability, UTC(5, 4, 30))).toBe(false)
    }),
  )

  it.effect("treats equal endpoints as the whole local calendar day", () =>
    Effect.gen(function* () {
      // Equal endpoints cover the local day, including the final minute.
      const availability: Model.Availability = { windows: [{ start: "06:00", end: "06:00" }] }
      for (let day = 0; day < 7; day++) {
        expect(yield* blocked(availability, UTC(day, 12, 0))).toBe(true)
        expect(yield* blocked(availability, UTC(day, 23, 59))).toBe(true)
        expect(yield* blocked(availability, UTC(day, 0, 0))).toBe(true)
      }
    }),
  )

  it.effect("restricts a whole-day window with equal endpoints to listed days", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [{ days: ["tue", "thu"], start: "06:00", end: "06:00" }],
      }
      // Tuesday and Thursday are listed, regardless of the matching clock time.
      expect(yield* blocked(availability, UTC(2, 0, 0))).toBe(true)
      expect(yield* blocked(availability, UTC(2, 23, 59))).toBe(true)
      expect(yield* blocked(availability, UTC(4, 12, 0))).toBe(true)
      expect(yield* blocked(availability, UTC(1, 12, 0))).toBe(false)
      expect(yield* blocked(availability, UTC(5, 12, 0))).toBe(false)
    }),
  )

  it.effect("allows the whole local calendar day when endpoints are equal in allow mode", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        mode: "allow",
        windows: [{ start: "08:00", end: "08:00" }],
      }
      expect(yield* blocked(availability, UTC(2, 8, 0))).toBe(false)
      expect(yield* blocked(availability, UTC(2, 23, 59))).toBe(false)
      expect(yield* blocked(availability, UTC(2, 7, 59))).toBe(false)
      expect(yield* blocked(availability, UTC(2, 12, 30))).toBe(false)
    }),
  )

  it.effect("applies a whole-day window on every day by default", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = { windows: [{ start: "00:00", end: "00:00" }] }
      for (let day = 0; day < 7; day++) expect(yield* blocked(availability, UTC(day, 12, 0))).toBe(true)
    }),
  )

  it.effect("evaluates windows in the configured timezone", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        timezone: "Asia/Tokyo",
        windows: [{ start: "09:00", end: "17:00" }],
      }
      // 00:00 UTC Monday is 09:00 JST Monday — the window start.
      expect(yield* blocked(availability, UTC(1, 0, 0))).toBe(true)
      // 07:30 UTC is 16:30 JST — inside.
      expect(yield* blocked(availability, UTC(1, 7, 30))).toBe(true)
      // 08:00 UTC is 17:00 JST Monday — the exclusive end.
      expect(yield* blocked(availability, UTC(1, 8, 0))).toBe(false)
      // 08:30 UTC is 17:30 JST — outside.
      expect(yield* blocked(availability, UTC(1, 8, 30))).toBe(false)
    }),
  )

  it.effect("fails with TimezoneError on an unknown timezone", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        timezone: "Mars/Olympus",
        windows: [{ start: "01:00", end: "04:00" }],
      }
      const result = yield* Effect.flip(
        ModelAvailability.check(model(availability)).pipe(Effect.provide(ModelAvailability.Now.at(UTC(1, 2)))),
      )
      expect(result._tag).toBe("ModelAvailability.TimezoneError")
    }),
  )
})
