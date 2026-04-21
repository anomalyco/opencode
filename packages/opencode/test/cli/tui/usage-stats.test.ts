import { describe, expect, test } from "bun:test"
import {
  type UsageRecord,
  activeDays,
  compareToWork,
  dayKey,
  distinctSessions,
  favoriteModel,
  filterByRange,
  formatCompact,
  formatDuration,
  formatPct,
  formatShortDate,
  heatmapGrid,
  heatmapLevel,
  longestSessionMs,
  mostActiveDay,
  perModelShare,
  rangeBounds,
  streaks,
  tokensPerDay,
  tokensPerModelPerDay,
  totalTokens,
} from "../../../src/cli/cmd/tui/util/usage-stats"

function at(dateStr: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  const [y, m, d, h = "0", min = "0"] = dateStr.split(/[- :]/)
  const timestamp = new Date(
    parseInt(y, 10),
    parseInt(m, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(min, 10),
  ).getTime()
  return {
    timestamp,
    model: "sonnet",
    input: 100,
    output: 200,
    sessionID: "s1",
    ...overrides,
  }
}

describe("formatCompact", () => {
  test("formats small numbers as integers", () => {
    expect(formatCompact(0)).toBe("0")
    expect(formatCompact(448)).toBe("448")
    expect(formatCompact(999)).toBe("999")
  })

  test("formats thousands", () => {
    expect(formatCompact(1000)).toBe("1k")
    expect(formatCompact(2500)).toBe("2.5k")
    expect(formatCompact(141_900)).toBe("141.9k")
    expect(formatCompact(670_600)).toBe("670.6k")
  })

  test("formats millions and billions", () => {
    expect(formatCompact(1_000_000)).toBe("1M")
    expect(formatCompact(4_250_000)).toBe("4.3M")
    expect(formatCompact(1_500_000_000)).toBe("1.5B")
  })
})

describe("formatDuration", () => {
  test("formats known patterns", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(90_000)).toBe("1m 30s")
    const nineHours = 9 * 3600_000 + 42 * 60_000 + 28_000
    expect(formatDuration(nineHours)).toBe("9h 42m 28s")
    expect(formatDuration(26 * 3600_000)).toBe("1d 2h 0m 0s")
  })

  test("handles invalid input safely", () => {
    expect(formatDuration(Number.NaN)).toBe("0s")
    expect(formatDuration(-1)).toBe("0s")
  })
})

describe("formatPct", () => {
  test("1 decimal when needed", () => {
    expect(formatPct(0.1234)).toBe("12.3%")
    expect(formatPct(0.5)).toBe("50%")
    expect(formatPct(1)).toBe("100%")
    expect(formatPct(0)).toBe("0%")
  })
})

describe("rangeBounds / filterByRange", () => {
  const now = new Date(2026, 3, 21, 12, 0, 0).getTime() // Apr 21, 2026

  test("all time returns undefined (no filter)", () => {
    expect(rangeBounds("all", now)).toBeUndefined()
    const records = [at("2020-01-01"), at("2026-04-21")]
    expect(filterByRange(records, "all", now)).toEqual(records)
  })

  test("last 7 days includes today + previous 6 days", () => {
    const b = rangeBounds("7d", now)!
    const start = new Date(b.start)
    const end = new Date(b.end)
    expect(start.getDate()).toBe(15)
    expect(start.getMonth()).toBe(3)
    expect(end.getDate()).toBe(21)
    // Boundaries sit on day edges in local time
    expect(start.getHours()).toBe(0)
    expect(end.getHours()).toBe(23)
  })

  test("last 30 days includes today + previous 29 days", () => {
    const b = rangeBounds("30d", now)!
    const span = Math.round((b.end - b.start) / 86_400_000)
    // 30 days inclusive = 29 day-boundary steps
    expect(span).toBe(30)
  })

  test("filters records outside the range", () => {
    const records = [
      at("2026-04-15"), // at start
      at("2026-04-10"), // before start
      at("2026-04-21"), // today
    ]
    const filtered = filterByRange(records, "7d", now)
    expect(filtered.map((r) => dayKey(r.timestamp))).toEqual(["2026-04-15", "2026-04-21"])
  })
})

describe("aggregation", () => {
  const records = [
    at("2026-04-19 10:00", { model: "sonnet", input: 100, output: 200, sessionID: "s1" }),
    at("2026-04-19 11:00", { model: "opus", input: 50, output: 150, sessionID: "s1" }),
    at("2026-04-20 09:00", { model: "sonnet", input: 400, output: 600, sessionID: "s2" }),
    at("2026-04-21 08:00", { model: "haiku", input: 10, output: 20, sessionID: "s3" }),
  ]

  test("totalTokens sums input+output", () => {
    expect(totalTokens(records)).toBe(1530)
  })

  test("tokensPerDay groups by local-time day", () => {
    const perDay = tokensPerDay(records)
    expect(perDay).toEqual([
      { day: "2026-04-19", input: 150, output: 350, total: 500 },
      { day: "2026-04-20", input: 400, output: 600, total: 1000 },
      { day: "2026-04-21", input: 10, output: 20, total: 30 },
    ])
  })

  test("tokensPerModelPerDay produces per-model series", () => {
    const series = tokensPerModelPerDay(records)
    expect([...series.keys()].sort()).toEqual(["haiku", "opus", "sonnet"])
    expect(series.get("sonnet")).toEqual([
      { day: "2026-04-19", input: 100, output: 200, total: 300 },
      { day: "2026-04-20", input: 400, output: 600, total: 1000 },
    ])
  })

  test("perModelShare sorts desc by total and includes share", () => {
    const share = perModelShare(records)
    expect(share.map((s) => s.model)).toEqual(["sonnet", "opus", "haiku"])
    expect(share[0].total).toBe(1300)
    expect(share[0].share).toBeCloseTo(1300 / 1530, 4)
    expect(share.reduce((s, m) => s + m.share, 0)).toBeCloseTo(1, 4)
  })

  test("favoriteModel returns highest-total model", () => {
    expect(favoriteModel(records)).toBe("sonnet")
  })

  test("distinctSessions and activeDays", () => {
    expect(distinctSessions(records)).toBe(3)
    expect(activeDays(records)).toEqual(["2026-04-19", "2026-04-20", "2026-04-21"])
  })

  test("mostActiveDay picks highest-total day", () => {
    expect(mostActiveDay(records)).toEqual({ day: "2026-04-20", total: 1000 })
  })
})

describe("empty states", () => {
  test("handles no records", () => {
    expect(totalTokens([])).toBe(0)
    expect(tokensPerDay([])).toEqual([])
    expect(perModelShare([])).toEqual([])
    expect(favoriteModel([])).toBeUndefined()
    expect(distinctSessions([])).toBe(0)
    expect(activeDays([])).toEqual([])
    expect(mostActiveDay([])).toBeUndefined()
    expect(longestSessionMs([])).toBe(0)
    expect(streaks([])).toEqual({ longest: 0, current: 0 })
  })
})

describe("longestSessionMs", () => {
  test("uses sessionStart/sessionEnd when provided", () => {
    const start = at("2026-04-20 10:00").timestamp
    const end = at("2026-04-20 19:42:28").timestamp
    const recs = [
      at("2026-04-20 12:00", { sessionID: "a", sessionStart: start, sessionEnd: end }),
      at("2026-04-20 15:00", { sessionID: "a", sessionStart: start, sessionEnd: end }),
      at("2026-04-21 10:00", { sessionID: "b", sessionStart: at("2026-04-21 10:00").timestamp, sessionEnd: at("2026-04-21 10:30").timestamp }),
    ]
    expect(longestSessionMs(recs)).toBe(end - start)
  })

  test("falls back to min/max of record timestamps", () => {
    const recs = [
      at("2026-04-20 10:00", { sessionID: "a" }),
      at("2026-04-20 10:30", { sessionID: "a" }),
      at("2026-04-20 13:00", { sessionID: "a" }),
    ]
    expect(longestSessionMs(recs)).toBe(3 * 3600_000)
  })
})

describe("streaks", () => {
  const now = new Date(2026, 3, 21, 12, 0, 0).getTime()

  test("longest streak of consecutive active days", () => {
    const recs = [
      at("2026-04-01"),
      at("2026-04-02"),
      at("2026-04-03"),
      // gap
      at("2026-04-10"),
      at("2026-04-11"),
    ]
    expect(streaks(recs, now)).toEqual({ longest: 3, current: 0 })
  })

  test("current streak counts back from today", () => {
    const recs = [at("2026-04-19"), at("2026-04-20"), at("2026-04-21")]
    expect(streaks(recs, now)).toEqual({ longest: 3, current: 3 })
  })

  test("current streak is 0 if today missing", () => {
    const recs = [at("2026-04-19"), at("2026-04-20")]
    expect(streaks(recs, now)).toEqual({ longest: 2, current: 0 })
  })
})

describe("heatmap", () => {
  const now = new Date(2026, 3, 21, 12, 0, 0).getTime()

  test("grid has 7 rows per week", () => {
    const grid = heatmapGrid([], now, 10)
    expect(grid.weeks.length).toBe(10)
    for (const col of grid.weeks) expect(col.length).toBe(7)
  })

  test("levels scale 0..4 with saturation", () => {
    expect(heatmapLevel(0, 10)).toBe(0)
    expect(heatmapLevel(0.5, 10)).toBe(1)
    expect(heatmapLevel(2, 10)).toBe(2)
    expect(heatmapLevel(5, 10)).toBe(3)
    expect(heatmapLevel(9, 10)).toBe(4)
    expect(heatmapLevel(5, 0)).toBe(0)
  })

  test("populates cells for known timestamps", () => {
    const recs = [at("2026-04-21 10:00", { input: 100, output: 100 })]
    const grid = heatmapGrid(recs, now, 4)
    const allCells = grid.weeks.flat().filter((c) => c.day)
    const today = allCells.find((c) => c.day === "2026-04-21")
    expect(today?.total).toBe(200)
    expect(grid.max).toBe(200)
  })
})

describe("compareToWork", () => {
  test("returns undefined for very low totals", () => {
    expect(compareToWork(0)).toBeUndefined()
    expect(compareToWork(400)).toBeUndefined()
  })

  test("picks a reasonable reference for mid-range totals", () => {
    const result = compareToWork(700_000)
    expect(result).toBeDefined()
    expect(result!.multiplier).toBeGreaterThan(0)
    expect(result!.name.length).toBeGreaterThan(0)
  })

  test("handles very large totals without crashing", () => {
    const result = compareToWork(100_000_000_000)
    expect(result).toBeDefined()
  })
})

describe("formatShortDate", () => {
  test("formats day keys as short month/day", () => {
    expect(formatShortDate("2026-04-20")).toBe("Apr 20")
  })
})
