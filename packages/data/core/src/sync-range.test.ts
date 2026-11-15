import { describe, expect, test } from "bun:test"
import { buildRetentionQueries, buildStatsQueries } from "./domain/inference"
import { syncRange } from "./sync-range"

const source = { namespace: "inference", table: "generation", dataset: "zen" }

describe("sync range", () => {
  test("keeps hourly passes on the current ISO week and leaves older periods to the history pass", () => {
    const startedAt = new Date("2026-10-23T19:05:00.000Z")

    expect(syncRange(startedAt)).toEqual({
      periodStart: new Date("2026-10-19T00:00:00.000Z"),
      periodEnd: new Date("2026-10-23T19:00:00.000Z"),
      retentionStart: new Date("2026-10-07T00:00:00.000Z"),
      retentionEnd: new Date("2026-10-23T00:00:00.000Z"),
    })
    expect(periodKeys(syncRange(startedAt))).toEqual([
      "week 2026-W43",
      "day 2026-10-19",
      "day 2026-10-20",
      "day 2026-10-21",
      "day 2026-10-22",
      "day 2026-10-23",
    ])
    expect(cohorts(syncRange(startedAt))).toEqual(["2026-10-05"])

    expect(syncRange(startedAt, true)).toEqual({
      periodStart: new Date("2026-08-28T19:00:00.000Z"),
      periodEnd: new Date("2026-10-19T00:00:00.000Z"),
      retentionStart: new Date("2026-08-28T19:00:00.000Z"),
      retentionEnd: new Date("2026-10-12T00:00:00.000Z"),
    })
    expect(cohorts(syncRange(startedAt, true))).toEqual([
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ])
  })

  test.each([
    ["mid-week", "2026-10-23T19:05:00.000Z"],
    ["late Sunday", "2026-10-25T23:59:00.000Z"],
    ["Monday while hourly passes still finish the previous week", "2026-10-26T01:05:00.000Z"],
    ["Monday after the previous week is final", "2026-10-26T03:05:00.000Z"],
  ])("splits the display window without gaps or overlap: %s", (_, time) => {
    const incremental = syncRange(new Date(time))
    const history = syncRange(new Date(time), true)
    const display = { ...history, periodEnd: incremental.periodEnd, retentionEnd: incremental.retentionEnd }

    expect([...periodKeys(history), ...periodKeys(incremental)].toSorted()).toEqual(periodKeys(display).toSorted())
    expect([...cohorts(history), ...cohorts(incremental)].toSorted()).toEqual(cohorts(display).toSorted())
  })
})

function periodKeys(range: ReturnType<typeof syncRange>) {
  return [
    ...new Set(
      buildStatsQueries(range.periodStart, range.periodEnd, source).flatMap((query) =>
        [...query.matchAll(/'(day|week)' AS grain,\s+'([^']+)' AS period_key/g)].map(
          (match) => `${match[1]} ${match[2]}`,
        ),
      ),
    ),
  ]
}

function cohorts(range: ReturnType<typeof syncRange>) {
  return buildRetentionQueries(range.retentionStart, range.retentionEnd, source).flatMap((item) => item.cohortDates)
}
