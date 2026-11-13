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

const blocked =
  (availability: Model.Availability, at: Date) =>
  ModelAvailability.check(model(availability)).pipe(
    Effect.provide(ModelAvailability.Now.at(at)),
    Effect.map((available) => !available),
  )

describe("ModelAvailability.check", () => {
  it.effect("allows any time without availability config", () =>
    Effect.gen(function* () {
      expect(yield* ModelAvailability.check(model(undefined)).pipe(Effect.provide(ModelAvailability.Now.at(UTC(1, 2))))).toBe(true)
    }),
  )

  it.effect("blocks within a block window on listed days, inclusive boundaries", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "01:00", end: "04:00" }],
      }
      // Monday 01:00 UTC — the window start.
      expect(yield* blocked(availability, UTC(1, 1, 0))).toBe(true)
      // Monday 04:00 UTC — the inclusive end.
      expect(yield* blocked(availability, UTC(1, 4, 0))).toBe(true)
      // Monday 04:01 UTC — just past the window.
      expect(yield* blocked(availability, UTC(1, 4, 1))).toBe(false)
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
      // After the second peak.
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
    }),
  )

  it.effect("supports a window that wraps midnight across listed days", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = {
        windows: [{ days: ["fri"], start: "22:00", end: "04:00" }],
      }
      // Friday 23:00 — inside.
      expect(yield* blocked(availability, UTC(5, 23, 0))).toBe(true)
      // Saturday 03:00 — the Friday window still applies after midnight.
      expect(yield* blocked(availability, UTC(6, 3, 0))).toBe(true)
      // Saturday 05:00 — past the wrapped end.
      expect(yield* blocked(availability, UTC(6, 5, 0))).toBe(false)
      // Thursday 23:00 — not a listed day.
      expect(yield* blocked(availability, UTC(4, 23, 0))).toBe(false)
    }),
  )

  it.effect("applies a whole-day window on every day by default", () =>
    Effect.gen(function* () {
      const availability: Model.Availability = { windows: [{ start: "00:00", end: "23:59" }] }
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
      // 08:00 UTC is 17:00 JST Monday — the inclusive end.
      expect(yield* blocked(availability, UTC(1, 8, 0))).toBe(true)
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
