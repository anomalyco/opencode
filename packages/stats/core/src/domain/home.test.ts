import { describe, expect, test } from "bun:test"
import type { ModelStatMetric } from "./model"
import type { RetentionMetricRow } from "./home"

process.env.SST_RESOURCE_App = JSON.stringify({ name: "opencode", stage: "test" })
process.env.SST_RESOURCE_StatsDatabase = JSON.stringify({ url: "mysql://localhost/stats" })
process.env.SST_RESOURCE_StatsPublicModelAliases = JSON.stringify({ value: '{"unknown/internal-code":"Public Model"}' })

const { buildRetentionEntries, buildStatsHomeData, buildStatsModelData, normalizeStatRows } = await import("./home")

test("daily rankings use the latest day while weekly rankings retain seven days and their previous-period change", () => {
  const rows = Array.from({ length: 14 }, (_, index) =>
    [
      { model: "model-a", totalTokens: index === 13 ? 3_000_000_000 : 1_000_000_000 },
      { model: "model-b", totalTokens: index === 13 ? 2_000_000_000 : 4_000_000_000 },
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
  const rankings = buildStatsHomeData(rows, [], []).leaderboard.Go

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

test("public model aliases cover historical rows, rankings, model data, peers, and retention", () => {
  const row: ModelStatMetric = {
    periodKey: "2026-09-27",
    updatedAt: new Date("2026-09-28T00:00:00.000Z"),
    tier: "Go",
    provider: "unknown",
    model: "internal-code",
    sessions: 2,
    uniqueUsers: 1,
    inputTokens: 40,
    outputTokens: 60,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 100,
    inputCostMicrocents: 0,
    outputCostMicrocents: 0,
    totalCostMicrocents: 0,
  }
  const retention: RetentionMetricRow = {
    cohortDate: "2026-09-20",
    updatedAt: Date.UTC(2026, 8, 27),
    provider: "unknown",
    model: "internal-code",
    eligibleUsers: 200,
    retainedUsers: 100,
  }
  const home = buildStatsHomeData([row], [], [retention])
  const model = buildStatsModelData("public-model", [row], [], "unknown", [retention])

  expect(normalizeStatRows([row])).toMatchObject([{ model: "Public Model", provider: "unknown" }])
  expect(home.leaderboard.Go["1W"][0]?.model).toBe("Public Model")
  expect(home.usage.Go["2M"].flatMap((day) => day.segments).map((item) => item.model)).toContain("Public Model")
  expect(home.retention[0]?.model).toBe("Public Model")
  expect(model).toMatchObject({
    model: "Public Model",
    slug: "public-model",
    weeklyRetention: { model: "Public Model" },
  })
  expect(model?.peers[0]?.model).toBe("Public Model")
  expect(buildStatsModelData("internal-code", [row], [], "unknown", [retention])).toBeNull()
  expect(JSON.stringify({ home, model })).not.toContain("internal-code")
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
