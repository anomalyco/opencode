import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import {
  buildHomeActivity,
  formatActivityTokenAmount,
  HOME_ACTIVITY_DAYS,
  HOME_ACTIVITY_WEEKS,
  type HomeActivityRecord,
} from "./activity"

const now = DateTime.fromISO("2026-06-06T12:00:00", { zone: "utc" })
const DAY = 24 * 60 * 60 * 1000

function record(
  daysAgo: number,
  options: {
    updatedOffset?: number
    tokens?: HomeActivityRecord["session"]["tokens"]
  } = {},
): HomeActivityRecord {
  const created = now.minus({ days: daysAgo }).toMillis()
  return {
    session: {
      time: {
        created,
        updated: options.updatedOffset ? created + options.updatedOffset : undefined,
      },
      tokens: options.tokens,
    },
  }
}

// ── formatActivityTokenAmount ───────────────────────────────────────────────

describe("formatActivityTokenAmount", () => {
  test("returns 0 for zero", () => {
    expect(formatActivityTokenAmount(0, "en")).toBe("0")
  })

  test("returns 0 for negative", () => {
    expect(formatActivityTokenAmount(-5, "en")).toBe("0")
  })

  test("returns 0 for NaN/Infinity", () => {
    expect(formatActivityTokenAmount(NaN, "en")).toBe("0")
    expect(formatActivityTokenAmount(Infinity, "en")).toBe("0")
  })

  test("formats small numbers without suffix", () => {
    expect(formatActivityTokenAmount(1, "en")).toBe("1")
    expect(formatActivityTokenAmount(250, "en")).toBe("250")
    expect(formatActivityTokenAmount(999, "en")).toBe("999")
  })

  test("formats thousands with K suffix", () => {
    expect(formatActivityTokenAmount(1_000, "en")).toBe("1K")
    expect(formatActivityTokenAmount(1_500, "en")).toBe("1.5K")
    expect(formatActivityTokenAmount(12_300, "en")).toBe("12.3K")
    expect(formatActivityTokenAmount(99_900, "en")).toBe("99.9K")
    expect(formatActivityTokenAmount(100_000, "en")).toBe("100K")
    expect(formatActivityTokenAmount(999_400, "en")).toBe("999K")
  })

  test("crosses unit boundary at 999.5K → 1M", () => {
    expect(formatActivityTokenAmount(999_500, "en")).toBe("1M")
    expect(formatActivityTokenAmount(999_499, "en")).toBe("999K")
  })

  test("formats millions with M suffix", () => {
    expect(formatActivityTokenAmount(1_000_000, "en")).toBe("1M")
    expect(formatActivityTokenAmount(2_500_000, "en")).toBe("2.5M")
    expect(formatActivityTokenAmount(12_300_000, "en")).toBe("12.3M")
    expect(formatActivityTokenAmount(100_000_000, "en")).toBe("100M")
    expect(formatActivityTokenAmount(999_400_000, "en")).toBe("999M")
  })

  test("crosses unit boundary at 999.5M → 1B", () => {
    expect(formatActivityTokenAmount(999_500_000, "en")).toBe("1B")
  })

  test("formats billions with B suffix", () => {
    expect(formatActivityTokenAmount(1_000_000_000, "en")).toBe("1B")
    expect(formatActivityTokenAmount(1_400_000_000, "en")).toBe("1.4B")
    expect(formatActivityTokenAmount(12_000_000_000, "en")).toBe("12B")
  })

  test("respects locale formatting", () => {
    expect(formatActivityTokenAmount(1_500, "de")).toBe("1,5K")
    expect(formatActivityTokenAmount(2_500_000, "de")).toBe("2,5M")
  })
})

// ── buildHomeActivity core ──────────────────────────────────────────────────

describe("buildHomeActivity", () => {
  test("has correct constants", () => {
    expect(HOME_ACTIVITY_DAYS).toBe(280)
    expect(HOME_ACTIVITY_WEEKS).toBe(40)
  })

  test("returns empty structure for no records", () => {
    const activity = buildHomeActivity([], "en", now)

    expect(activity.days).toHaveLength(HOME_ACTIVITY_DAYS)
    expect(activity.weekCount).toBe(HOME_ACTIVITY_WEEKS)
    expect(activity.totalTokens).toBe(0)
    expect(activity.peakTokens).toBe(0)
    expect(activity.hasActivity).toBe(false)
    expect(activity.metric).toBe("sessions")
    expect(activity.currentStreak).toBe(0)
    expect(activity.longestStreak).toBe(0)
    expect(activity.longestTaskMs).toBe(0)
  })

  test("builds token heatmap with correct window boundaries", () => {
    const activity = buildHomeActivity(
      [
        record(0, { tokens: { input: 100, output: 50 } }),
        record(0, { tokens: { input: 250 } }),
        record(2, { tokens: { input: 40 } }),
        record(HOME_ACTIVITY_DAYS - 1, { tokens: { input: 10 } }),
        record(HOME_ACTIVITY_DAYS, { tokens: { input: 999 } }),
      ],
      "en",
      now,
    )

    expect(activity.days).toHaveLength(HOME_ACTIVITY_DAYS)
    expect(activity.weekCount).toBe(HOME_ACTIVITY_WEEKS)
    expect(activity.totalTokens).toBe(450)
    expect(activity.peakTokens).toBe(400)
    expect(activity.metric).toBe("tokens")
    expect(activity.hasActivity).toBe(true)

    const todayIndex = HOME_ACTIVITY_DAYS - 1
    expect(activity.days[todayIndex]?.tokens).toBe(400)
    expect(activity.days[todayIndex]?.count).toBe(2)
    expect(activity.days[todayIndex]?.level).toBe(4)
    expect(activity.days[todayIndex]?.column).toBe(HOME_ACTIVITY_WEEKS)
    expect(activity.days[todayIndex]?.row).toBe(7)

    // Day 2 ago (index HOME_ACTIVITY_DAYS - 3) has 40 tokens, day 280 ago has 10
    expect(activity.days[HOME_ACTIVITY_DAYS - 3]?.tokens).toBe(40)
    expect(activity.days[0]?.tokens).toBe(10)
    expect(activity.days[0]?.count).toBe(1)
  })

  test("excludes records outside the window", () => {
    const activity = buildHomeActivity([record(HOME_ACTIVITY_DAYS, { tokens: { input: 500 } })], "en", now)

    expect(activity.totalTokens).toBe(0)
    expect(activity.hasActivity).toBe(false)
  })

  test("excludes records before the window", () => {
    const activity = buildHomeActivity([record(HOME_ACTIVITY_DAYS + 5, { tokens: { input: 500 } })], "en", now)

    expect(activity.totalTokens).toBe(0)
  })
})

// ── time handling ──────────────────────────────────────────────────────────

describe("time handling", () => {
  test("uses updated time for bucketing", () => {
    const activity = buildHomeActivity([record(20, { updatedOffset: 20 * DAY, tokens: { input: 20 } })], "en", now)

    // Record was created 20 days ago but updated to today
    expect(activity.totalTokens).toBe(20)
    expect(activity.days[HOME_ACTIVITY_DAYS - 1]?.tokens).toBe(20)
  })

  test("calculates longest task from created→updated span", () => {
    const activity = buildHomeActivity([record(0, { updatedOffset: 90 * 60_000, tokens: { input: 5 } })], "en", now)

    expect(activity.longestTaskMs).toBe(90 * 60_000)
  })

  test("skips records with invalid timestamps", () => {
    const badRecord: HomeActivityRecord = {
      session: { time: { created: NaN } },
    }
    const activity = buildHomeActivity([badRecord], "en", now)

    expect(activity.totalTokens).toBe(0)
    expect(activity.hasActivity).toBe(false)
  })

  test("handles zero-epoch created timestamp gracefully", () => {
    const zeroRecord: HomeActivityRecord = {
      session: { time: { created: 0 } },
    }
    const activity = buildHomeActivity([zeroRecord], "en", now)

    expect(activity.totalTokens).toBe(0)
    expect(activity.hasActivity).toBe(false)
  })
})

// ── streaks ─────────────────────────────────────────────────────────────────

describe("streaks", () => {
  test("calculates current and longest streaks from tokens", () => {
    const activity = buildHomeActivity(
      [
        record(0, { tokens: { input: 1 } }),
        record(1, { tokens: { input: 1 } }),
        record(3, { tokens: { input: 1 } }),
        record(4, { tokens: { input: 1 } }),
        record(5, { tokens: { input: 1 } }),
      ],
      "en",
      now,
    )

    expect(activity.currentStreak).toBe(2)
    expect(activity.longestStreak).toBe(3)
    expect(activity.metric).toBe("tokens")
  })

  test("returns 0 streaks when no activity", () => {
    const activity = buildHomeActivity([], "en", now)

    expect(activity.currentStreak).toBe(0)
    expect(activity.longestStreak).toBe(0)
  })

  test("handles single day activity", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 5 } })], "en", now)

    expect(activity.currentStreak).toBe(1)
    expect(activity.longestStreak).toBe(1)
  })

  test("handles all days active", () => {
    const records = Array.from({ length: 7 }, (_, i) => record(i, { tokens: { input: 1 } }))
    const activity = buildHomeActivity(records, "en", now)

    expect(activity.currentStreak).toBe(7)
    expect(activity.longestStreak).toBe(7)
  })

  test("current streak is 0 when today has no activity", () => {
    const activity = buildHomeActivity([record(1, { tokens: { input: 1 } })], "en", now)

    expect(activity.currentStreak).toBe(0)
    expect(activity.longestStreak).toBe(1)
  })
})

// ── metric fallback (tokens vs sessions) ────────────────────────────────────

describe("metric fallback", () => {
  test("uses tokens metric when any record has tokens", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 100 } }), record(0, {})], "en", now)

    expect(activity.metric).toBe("tokens")
  })

  test("falls back to sessions metric when no tokens present", () => {
    const activity = buildHomeActivity([record(0, {}), record(0, {}), record(1, {})], "en", now)

    expect(activity.metric).toBe("sessions")
    expect(activity.totalTokens).toBe(0)
    expect(activity.peakTokens).toBe(0)
    expect(activity.hasActivity).toBe(true)

    // Today has 2 sessions, yesterday has 1
    const today = activity.days[HOME_ACTIVITY_DAYS - 1]
    expect(today?.value).toBe(2)
    expect(today?.level).toBeGreaterThan(0)
  })

  test("session-only activity has correct level normalization", () => {
    const activity = buildHomeActivity(
      [record(0, {}), record(0, {}), record(0, {}), record(0, {}), record(1, {})],
      "en",
      now,
    )

    // Today has 4 sessions = highest = level 4
    // Yesterday has 1 session = level 1
    expect(activity.days[HOME_ACTIVITY_DAYS - 1]?.value).toBe(4)
    expect(activity.days[HOME_ACTIVITY_DAYS - 1]?.level).toBe(4)
    expect(activity.days[HOME_ACTIVITY_DAYS - 2]?.value).toBe(1)
    expect(activity.days[HOME_ACTIVITY_DAYS - 2]?.level).toBe(1)
  })
})

// ── token aggregation ──────────────────────────────────────────────────────

describe("token aggregation", () => {
  test("sums all token components correctly", () => {
    const activity = buildHomeActivity(
      [
        record(0, {
          tokens: {
            input: 100,
            output: 50,
            reasoning: 30,
            cache: { read: 10, write: 5 },
          },
        }),
      ],
      "en",
      now,
    )

    expect(activity.totalTokens).toBe(195) // 100 + 50 + 30 + 10 + 5
  })

  test("handles partial token objects", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 100 } })], "en", now)

    expect(activity.totalTokens).toBe(100)
  })

  test("handles missing token fields gracefully", () => {
    const activity = buildHomeActivity(
      [record(0, { tokens: { input: 50 } })],
      "en",
      now,
    )

    expect(activity.totalTokens).toBe(50)
  })

  test("peakTokens tracks highest single-day total", () => {
    const activity = buildHomeActivity(
      [
        record(0, { tokens: { input: 10 } }),
        record(0, { tokens: { input: 20 } }),
        record(1, { tokens: { input: 50 } }),
        record(2, { tokens: { input: 30 } }),
      ],
      "en",
      now,
    )

    expect(activity.peakTokens).toBe(50) // yesterday at 50 is peak
    expect(activity.totalTokens).toBe(110)
  })
})

// ── month labels ────────────────────────────────────────────────────────────

describe("month labels", () => {
  test("generates month labels", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 1 } })], "en", now)

    expect(activity.months.length).toBeGreaterThan(0)
    expect(activity.months[0]).toHaveProperty("key")
    expect(activity.months[0]).toHaveProperty("label")
    expect(activity.months[0]).toHaveProperty("column")
    expect(activity.months[0]).toHaveProperty("span")
    const first = activity.months[0]
    expect(first).toBeDefined()
    expect(first.span).toBeGreaterThanOrEqual(1)
  })

  test("month labels start at column 1", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 1 } })], "en", now)

    const first = activity.months[0]
    expect(first).toBeDefined()
    expect(first.column).toBe(1)
  })
})

// ── day structure ───────────────────────────────────────────────────────────

describe("day structure", () => {
  test("each day has required properties", () => {
    const activity = buildHomeActivity([record(0, { tokens: { input: 1 } })], "en", now)

    for (const day of activity.days) {
      expect(day).toHaveProperty("key")
      expect(day).toHaveProperty("label")
      expect(day).toHaveProperty("count")
      expect(day).toHaveProperty("tokens")
      expect(day).toHaveProperty("value")
      expect(day).toHaveProperty("level")
      expect(day).toHaveProperty("column")
      expect(day).toHaveProperty("row")
      expect(day.row).toBeGreaterThanOrEqual(1)
      expect(day.row).toBeLessThanOrEqual(7)
      expect(day.column).toBeGreaterThanOrEqual(1)
      expect(day.column).toBeLessThanOrEqual(HOME_ACTIVITY_WEEKS)
    }
  })

  test("days are chronologically ordered left to right, bottom to top", () => {
    const activity = buildHomeActivity([], "en", now)

    // First day (oldest) is row 1, column 1
    const first = activity.days[0]
    expect(first?.column).toBe(1)
    expect(first?.row).toBe(1)

    // Last day (today) is at the end
    const last = activity.days[HOME_ACTIVITY_DAYS - 1]
    expect(last?.column).toBe(HOME_ACTIVITY_WEEKS)
  })
})
