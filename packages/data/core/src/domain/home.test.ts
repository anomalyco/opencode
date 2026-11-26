import { describe, expect, test } from "bun:test"
import type { ModelStatMetric } from "./model"
import type { RetentionMetricRow } from "./home"

process.env.DATA_DATABASE_HOST = "localhost"
process.env.DATA_DATABASE_USERNAME = "stats"
process.env.DATA_DATABASE_PASSWORD = "stats"

const { buildRetentionEntries, buildStatsHomeData, normalizeStatRows } = await import("./home")

test("daily rankings use yesterday while weekly rankings retain seven days and their previous-period change", () => {
  const rows = Array.from({ length: 14 }, (_, index) =>
    [
      { model: "model-a", totalTokens: index === 12 ? 3_000_000_000 : 1_000_000_000 },
      { model: "model-b", totalTokens: index === 12 ? 2_000_000_000 : 4_000_000_000 },
    ].map(
      (item) =>
        ({
          periodKey: `2026-09-${String(index + 1).padStart(2, "0")}`,
          updatedAt: new Date(Date.UTC(2026, 8, index + 1)),
          tier: "Go",
          provider: "test",
          model: item.model,
          sessions: 1,
          uniqueUsers: 1,
          inputTokens: item.totalTokens,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          totalTokens: item.totalTokens,
          inputCostMicrocents: 0,
          outputCostMicrocents: 0,
          totalCostMicrocents: 0,
        }) satisfies ModelStatMetric,
    ),
  ).flat()
  const rankings = buildStatsHomeData(rows, [], [], []).leaderboard.Go

  expect(rankings["1D"].map((item) => [item.model, item.tokens, item.change])).toEqual([
    ["model-a", 3, 200],
    ["model-b", 2, -50],
  ])
  expect(rankings["1W"].map((item) => [item.model, item.tokens])).toEqual([
    ["model-b", 26],
    ["model-a", 9],
  ])
  expect(rankings["2M"]).toEqual(rankings["1W"])
})

test("new model days rank individual models and take their share of all tokens", () => {
  const rows = [
    { model: "leader", totalTokens: 50 },
    { model: "launch", totalTokens: 30 },
    { model: "small-a", totalTokens: 10 },
    { model: "small-b", totalTokens: 10 },
  ].map(
    (item) =>
      ({
        periodKey: "2026-11-22",
        updatedAt: new Date(Date.UTC(2026, 10, 22)),
        tier: "Go",
        provider: "test",
        model: item.model,
        sessions: 1,
        uniqueUsers: 1,
        inputTokens: item.totalTokens,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        totalTokens: item.totalTokens,
        inputCostMicrocents: 0,
        outputCostMicrocents: 0,
        totalCostMicrocents: 0,
      }) satisfies ModelStatMetric,
  )

  const launch = buildStatsHomeData(rows, [], [], []).newModels.find((item) => item.model === "launch")

  expect(launch?.daily.at(-1)).toMatchObject({ share: 0.3, rank: 2 })
})

test("new models carry their distinct users for each week in the window", () => {
  const row = (periodKey: string, tier: string, uniqueUsers: number) =>
    ({
      periodKey,
      updatedAt: new Date(Date.UTC(2026, 10, 25)),
      tier,
      provider: "test",
      model: "launch",
      sessions: 1,
      uniqueUsers,
      inputTokens: 1,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 1,
      inputCostMicrocents: 0,
      outputCostMicrocents: 0,
      totalCostMicrocents: 0,
    }) satisfies ModelStatMetric
  const days = [row("2026-11-18", "Go", 5), row("2026-11-25", "Go", 5)]
  const weeks = [
    row("2026-W40", "Go", 99),
    row("2026-W47", "Go", 70),
    row("2026-W47", "Free", 30),
    row("2026-W48", "Go", 40),
  ]

  const launch = buildStatsHomeData(days, weeks, [], []).newModels.find((item) => item.model === "launch")

  expect(launch?.weekly).toEqual([
    { week: "2026-11-16", users: 100 },
    { week: "2026-11-23", users: 40 },
  ])
})

describe("weekly series", () => {
  const days = Array.from({ length: 18 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`).flatMap(
    (key) => [metric(key, "model-a", 1_000_000_000_000, 4), metric(key, "model-b", 2_000_000_000_000, 4)],
  )
  const weeks = [
    metric("2026-W44", "model-a", 9_000_000_000_000, 7),
    metric("2026-W47", "model-a", 3_000_000_000_000, 5),
    metric("2026-W47", "model-b", 1_000_000_000_000, 6),
  ]
  const data = buildStatsHomeData(days, weeks, [], [])

  test("covers the last 20 ISO weeks, the current one ending at the latest day", () => {
    expect(data.weekly.usage).toHaveLength(20)
    expect(data.weekly.usage[0]).toMatchObject({ start: "2026-07-06", end: "2026-07-12", date: "JUL 6 - JUL 12" })
    expect(data.weekly.usage.at(-4)).toMatchObject({ start: "2026-10-26", end: "2026-11-01", date: "OCT 26 - NOV 1" })
    expect(data.weekly.usage.at(-1)).toMatchObject({ start: "2026-11-16", end: "2026-11-18", date: "NOV 16 - NOV 18" })
    expect(data.weekly.market.at(-1)).toMatchObject({ start: "2026-11-16", end: "2026-11-18", total: 4 })
    expect(data.usage.Go["2M"].at(-1)).toMatchObject({ start: "2026-11-18", end: "2026-11-18", date: "NOV 18" })
  })

  test("reads weekly users from week rows instead of summing days", () => {
    expect(data.weekly.users.at(-1)?.segments).toEqual([
      { model: "model-a", value: 5 },
      { model: "model-b", value: 6 },
      { model: "Other", value: 0 },
    ])
  })

  test("stacks models in the daily order", () => {
    expect(data.weekly.usage.at(-1)?.segments).toEqual([
      { model: "model-b", value: 1 },
      { model: "model-a", value: 3 },
      { model: "Other", value: 0 },
    ])
  })

  test("colors past leaders that fell out of the past 7 days' top models", () => {
    const past = buildStatsHomeData(days, [...weeks, metric("2026-W32", "model-c", 50_000_000_000_000, 9)], [], [])
    expect(past.weekly.usage.find((point) => point.start === "2026-08-03")?.segments).toEqual([
      { model: "model-b", value: 0 },
      { model: "model-a", value: 0 },
      { model: "model-c", value: 50 },
      { model: "Other", value: 0 },
    ])
    expect(past.usage.Go["2M"].at(-1)?.segments.map((segment) => segment.model)).toEqual([
      "model-b",
      "model-a",
      "Other",
    ])
  })

  test("parses ISO week keys across year boundaries", () => {
    expect(
      ["2025-W01", "2026-W53", "2027-W01"].map((key) =>
        new Date(normalizeStatRows([metric(key, "model-a", 1, 1)])[0]!.periodStart).toISOString().slice(0, 10),
      ),
    ).toEqual(["2024-12-30", "2026-12-28", "2027-01-04"])
  })

  function metric(periodKey: string, model: string, totalTokens: number, uniqueUsers: number) {
    return {
      periodKey,
      updatedAt: new Date("2026-11-18T12:00:00.000Z"),
      tier: "Go",
      provider: "test",
      model,
      sessions: 1,
      uniqueUsers,
      inputTokens: totalTokens,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      totalTokens,
      inputCostMicrocents: 0,
      outputCostMicrocents: 0,
      totalCostMicrocents: 0,
    } satisfies ModelStatMetric
  }
})

describe("model usage attribution", () => {
  const row = {
    periodKey: "2026-09-27",
    updatedAt: new Date("2026-09-28T00:00:00.000Z"),
    tier: "Go",
    provider: "unknown",
    model: "longcat-2.5-preview",
    sessions: 1,
    uniqueUsers: 1,
    inputTokens: 50,
    outputTokens: 50,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 100,
    inputCostMicrocents: 0,
    outputCostMicrocents: 0,
    totalCostMicrocents: 0,
  }

  test("shows historical LongCat usage under Meituan", () => {
    expect(normalizeStatRows([row])).toMatchObject([{ provider: "meituan", model: "longcat-2.5-preview" }])
  })

  test("prefers recomputed rows over stale unknown dimensions", () => {
    expect(normalizeStatRows([row, { ...row, provider: "meituan" }])).toMatchObject([
      { provider: "meituan", totalTokens: 100 },
    ])
  })

  test("keeps unknown usage when a different lab has the same model name", () => {
    expect(normalizeStatRows([row, { ...row, provider: "another-lab" }])).toHaveLength(2)
  })
})

describe("retention aggregates", () => {
  test("pools the latest seven weekly cohorts and ranks models above the sample floor", () => {
    const rows = [
      ...cohorts("model-a", "provider-a", 8, 20, 10),
      ...cohorts("model-b", "provider-b", 8, 20, 12),
      ...cohorts("small-model", "provider-c", 8, 10, 9),
    ]
    const entries = buildRetentionEntries(rows)

    expect(entries.find((item) => item.model === "model-a")).toMatchObject({
      eligibleUserWeeks: 140,
      retainedUserWeeks: 70,
      rate: 50,
      rank: 2,
    })
    expect(entries.find((item) => item.model === "model-b")).toMatchObject({
      eligibleUserWeeks: 140,
      retainedUserWeeks: 84,
      rate: 60,
      rank: 1,
    })
    expect(entries.find((item) => item.model === "small-model")).toMatchObject({
      eligibleUserWeeks: 70,
      retainedUserWeeks: 63,
      rate: 90,
      rank: null,
    })
  })
})

function cohorts(model: string, provider: string, count: number, eligibleUsers: number, retainedUsers: number) {
  return Array.from({ length: count }, (_, index) => ({
    cohortDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    updatedAt: Date.UTC(2026, 7, index + 9),
    provider,
    model,
    eligibleUsers,
    retainedUsers,
  })) satisfies RetentionMetricRow[]
}

test("new models carry their users by last active day and the window those days cover", () => {
  const day = {
    periodKey: "2026-11-25",
    updatedAt: new Date(Date.UTC(2026, 10, 25)),
    tier: "Go",
    provider: "test",
    model: "launch",
    sessions: 1,
    uniqueUsers: 1,
    inputTokens: 1,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 1,
    inputCostMicrocents: 0,
    outputCostMicrocents: 0,
    totalCostMicrocents: 0,
  } satisfies ModelStatMetric
  const window = { windowStart: "2026-10-27", windowEnd: "2026-11-25" }
  const recency = [
    { ...window, model: "launch", lastActiveDate: "2026-11-20", users: 30 },
    { ...window, model: "launch", lastActiveDate: "2026-11-24", users: 70 },
    { ...window, model: "other", lastActiveDate: "2026-11-24", users: 5 },
  ]

  const models = buildStatsHomeData([day, { ...day, model: "quiet" }], [], [], [], recency).newModels

  expect(models.find((item) => item.model === "launch")?.recency).toEqual({
    start: "2026-10-27",
    end: "2026-11-25",
    days: [
      { date: "2026-11-20", users: 30 },
      { date: "2026-11-24", users: 70 },
    ],
  })
  expect(models.find((item) => item.model === "quiet")?.recency).toEqual({
    start: "2026-10-27",
    end: "2026-11-25",
    days: [],
  })
  expect(buildStatsHomeData([day], [], [], []).newModels[0]?.recency).toBeNull()
})
