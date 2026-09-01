import { describe, expect, test } from "bun:test"
import { activityCalendar } from "./activity-calendar.js"

const input = {
  from: new Date(2026, 0, 1).getTime(),
  to: new Date(2026, 0, 8).getTime(),
  maxWeeks: 53,
  activity: [
    { date: "2026-01-01", steps: 1 },
    { date: "2026-01-02", steps: 50 },
  ],
}

describe("activity calendar", () => {
  test("aligns Monday-first weeks and excludes cells outside the end-exclusive range", () => {
    const calendar = activityCalendar(input)
    expect(calendar.clipped).toBe(false)
    expect(calendar.weeks).toHaveLength(2)
    expect(calendar.weeks[0][0]).toEqual({ date: "2025-12-29", steps: 0, level: -1 })
    expect(calendar.weeks[0][3]).toEqual({ date: "2026-01-01", steps: 1, level: 2 })
    expect(calendar.weeks[0][4]).toEqual({ date: "2026-01-02", steps: 50, level: 4 })
    expect(calendar.weeks[1][2]).toEqual({ date: "2026-01-07", steps: 0, level: 0 })
    expect(calendar.weeks[1][3].level).toBe(-1)
    expect(calendar.months).toEqual([{ week: 0, label: "Jan", span: 2 }])
  })

  test("clips to the latest weeks and keeps empty days distinct from out-of-range cells", () => {
    const calendar = activityCalendar({ ...input, activity: [], maxWeeks: 1 })
    expect(calendar.clipped).toBe(true)
    expect(calendar.weeks).toHaveLength(1)
    expect(calendar.weeks[0][0]).toEqual({ date: "2026-01-05", steps: 0, level: 0 })
    expect(calendar.weeks[0][3].level).toBe(-1)
  })

  test("caps long histories at 53 weeks", () => {
    const calendar = activityCalendar({ ...input, from: new Date(2020, 0, 1).getTime(), maxWeeks: 200 })
    expect(calendar.clipped).toBe(true)
    expect(calendar.weeks).toHaveLength(53)
    expect(calendar.weeks.at(-1)?.[2].date).toBe("2026-01-07")
    expect(calendar.months.reduce((sum, month) => sum + month.span, 0)).toBe(53)
  })

  test("returns month positions and spans for partial first and last months", () => {
    const calendar = activityCalendar({
      ...input,
      from: new Date(2026, 3, 29).getTime(),
      to: new Date(2026, 4, 20).getTime(),
    })
    expect(calendar.months).toEqual([
      { week: 0, label: "Apr", span: 1 },
      { week: 1, label: "May", span: 3 },
    ])
    const partial = activityCalendar({
      ...input,
      from: new Date(2026, 3, 1).getTime(),
      to: new Date(2026, 3, 2).getTime(),
    })
    expect(partial.months).toEqual([{ week: 0, label: "Apr", span: 1 }])
  })

  test("places month labels across a year boundary", () => {
    const calendar = activityCalendar({
      ...input,
      from: new Date(2025, 11, 22).getTime(),
      to: new Date(2026, 0, 12).getTime(),
    })
    expect(calendar.months).toEqual([
      { week: 0, label: "Dec", span: 1 },
      { week: 1, label: "Jan", span: 2 },
    ])
  })

  test("keeps exactly seven distinct cells per week across DST and leap days", () => {
    const calendar = activityCalendar({
      from: new Date(2024, 1, 26).getTime(),
      to: new Date(2024, 2, 12).getTime(),
      maxWeeks: 53,
      activity: [
        { date: "2024-02-29", steps: 1 },
        { date: "2024-03-10", steps: 1 },
      ],
    })
    expect(calendar.weeks).toHaveLength(3)
    expect(
      calendar.weeks
        .flat()
        .filter((day) => day.steps > 0)
        .map((day) => day.date),
    ).toEqual(["2024-02-29", "2024-03-10"])
    expect(new Set(calendar.weeks.flat().map((day) => day.date)).size).toBe(21)
  })

  test("uses the highest intensity for a single distinct positive count", () => {
    const calendar = activityCalendar({ ...input, activity: input.activity.map((day) => ({ ...day, steps: 10 })) })
    expect(
      calendar.weeks
        .flat()
        .filter((day) => day.steps > 0)
        .map((day) => day.level),
    ).toEqual([4, 4])
  })

  test("ranks distinct activity counts in four levels", () => {
    const calendar = activityCalendar({
      ...input,
      to: new Date(2026, 0, 10).getTime(),
      activity: Array.from({ length: 8 }, (_, index) => ({ date: `2026-01-0${index + 1}`, steps: index + 1 })),
    })
    expect(
      calendar.weeks
        .flat()
        .filter((day) => day.steps > 0)
        .map((day) => day.level),
    ).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })

  test("keeps intensity relative to the requested range when older weeks are clipped", () => {
    const calendar = activityCalendar({
      ...input,
      maxWeeks: 1,
      activity: [
        { date: "2026-01-01", steps: 50 },
        { date: "2026-01-05", steps: 1 },
      ],
    })
    expect(calendar.weeks[0][0].level).toBe(2)
  })

  test("returns an empty calendar for an empty range", () => {
    expect(activityCalendar({ ...input, to: input.from, activity: [] })).toEqual({
      weeks: [],
      months: [],
      clipped: false,
    })
  })
})
