import { describe, expect, test } from "bun:test"
import type { SessionStatsInfo } from "@opencode-ai/client"
import { statsCalendar, statsMetrics, statsNumber, statsRange } from "../src/feature-plugins/system/stats-data"

const stats: SessionStatsInfo = {
  range: { from: new Date(2026, 0, 1).getTime(), to: new Date(2026, 0, 8).getTime() },
  sessions: 12,
  subagents: 99,
  prompts: 24,
  steps: 50,
  activeDays: 2,
  streak: 2,
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  cost: 0,
  tools: { mode: "none" },
  models: [],
  activity: [
    { date: "2026-01-01", steps: 1 },
    { date: "2026-01-02", steps: 50 },
  ],
}

describe("stats poster", () => {
  test("includes all token categories and replaces subagents with tokens", () => {
    expect(statsMetrics(stats)).toEqual([
      { label: "tokens", value: 15 },
      { label: "best streak", value: 2 },
      { label: "active days", value: 2 },
      { label: "sessions", value: 12 },
    ])
    expect([0, 685, 5284, 9_200_000_000].map(statsNumber)).toEqual(["0", "685", "5.3K", "9.2B"])
  })

  test("uses local calendar boundaries and a seven-day inclusive window", () => {
    const now = new Date(2026, 2, 10, 12)
    expect(statsRange("year", now).from).toBe(new Date(2026, 0, 1).getTime())
    expect(statsRange("month", now).from).toBe(new Date(2026, 2, 1).getTime())
    expect(statsRange("week", now).from).toBe(new Date(2026, 2, 4).getTime())
    expect(statsRange("all", now)).toEqual({ from: undefined, to: now.getTime() + 1, label: "All time" })
  })

  test("aligns Monday-first weeks, excludes out-of-range cells, and preserves intensity", () => {
    const calendar = statsCalendar(stats, 110)
    expect(calendar.clipped).toBe(false)
    expect(calendar.weeks).toHaveLength(2)
    expect(calendar.months.trim()).toBe("Jan")
    expect(calendar.weeks[0][0]).toMatchObject({ date: "2025-12-29", level: -1 })
    expect(calendar.weeks[0][3]).toMatchObject({ date: "2026-01-01", level: 1 })
    expect(calendar.weeks[0][4].level).toBeGreaterThan(calendar.weeks[0][3].level)
    expect(calendar.weeks[1][2]).toMatchObject({ date: "2026-01-07", level: 0 })
    expect(calendar.weeks[1][3].level).toBe(-1)
  })

  test("clips to the latest weeks on narrow screens and handles empty activity", () => {
    const calendar = statsCalendar({ ...stats, activity: [] }, 6)
    expect(calendar.clipped).toBe(true)
    expect(calendar.weeks).toHaveLength(1)
    expect(calendar.weeks[0][0]).toMatchObject({ date: "2026-01-05", level: 0 })
    expect(calendar.weeks.flat().every((day) => day.level <= 0)).toBe(true)
  })

  test("does not overlap labels at a partial first month", () => {
    const calendar = statsCalendar(
      {
        ...stats,
        range: { from: new Date(2026, 3, 29).getTime(), to: new Date(2026, 4, 20).getTime() },
      },
      110,
    )
    expect(calendar.months.trim()).toBe("May")
  })

  test("keeps exactly seven cells per week across DST and leap days", () => {
    const calendar = statsCalendar(
      {
        ...stats,
        range: { from: new Date(2024, 1, 26).getTime(), to: new Date(2024, 2, 12).getTime() },
        activity: [
          { date: "2024-02-29", steps: 1 },
          { date: "2024-03-10", steps: 1 },
        ],
      },
      110,
    )
    expect(calendar.weeks).toHaveLength(3)
    expect(
      calendar.weeks
        .flat()
        .filter((day) => day.steps > 0)
        .map((day) => day.date),
    ).toEqual(["2024-02-29", "2024-03-10"])
    expect(new Set(calendar.weeks.flat().map((day) => day.date)).size).toBe(21)
  })
})
