import { describe, expect, test } from "bun:test"
import { instanceId, recentInstanceIds, skipReason } from "./schedule"

describe("stats sync schedule", () => {
  test("names one instance per hourly slot and per history day", () => {
    const at = new Date("2026-11-03T03:20:00.000Z")

    expect(instanceId(at, false)).toBe("stats-hourly-2026-11-03T03")
    expect(instanceId(at, true)).toBe("stats-history-2026-11-03")
    expect(instanceId(new Date("2026-11-03T03:05:59.999Z"), false)).toBe("stats-hourly-2026-11-03T03")
  })

  test("probes this slot, the previous five hours and the previous two history days", () => {
    expect(recentInstanceIds(new Date("2026-11-01T02:05:00.000Z"))).toEqual([
      "stats-hourly-2026-11-01T02",
      "stats-hourly-2026-11-01T01",
      "stats-hourly-2026-11-01T00",
      "stats-hourly-2026-10-31T23",
      "stats-hourly-2026-10-31T22",
      "stats-hourly-2026-10-31T21",
      "stats-history-2026-11-01",
      "stats-history-2026-10-31",
      "stats-history-2026-10-30",
    ])
  })

  test("starts when no recent instance is active", () => {
    expect(
      skipReason("stats-hourly-2026-11-03T04", [
        { id: "stats-hourly-2026-11-03T04", status: undefined },
        { id: "stats-hourly-2026-11-03T03", status: "complete" },
        { id: "stats-hourly-2026-11-03T02", status: "errored" },
        { id: "stats-history-2026-11-03", status: "terminated" },
      ]),
    ).toBeUndefined()
  })

  test.each(["queued", "running", "waiting", "paused", "waitingForPause"])(
    "skips while a previous run is %s",
    (status) => {
      expect(
        skipReason("stats-hourly-2026-11-03T04", [
          { id: "stats-hourly-2026-11-03T04", status: undefined },
          { id: "stats-history-2026-11-03", status },
        ]),
      ).toEqual({ reason: "previous run active", instance: "stats-history-2026-11-03", status })
    },
  )

  test("skips a slot that already has an instance in any state", () => {
    expect(skipReason("stats-history-2026-11-03", [{ id: "stats-history-2026-11-03", status: "complete" }])).toEqual({
      reason: "already created",
      instance: "stats-history-2026-11-03",
      status: "complete",
    })
  })
})
