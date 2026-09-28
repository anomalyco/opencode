import { describe, expect, test } from "bun:test"
import type { ModelStatMetric } from "./model"
import type { RetentionMetricRow } from "./home"

process.env.SST_RESOURCE_App = JSON.stringify({ name: "opencode", stage: "test" })
process.env.SST_RESOURCE_StatsDatabase = JSON.stringify({ url: "mysql://localhost/stats" })

const { buildRetentionEntries, buildStatsHomeData } = await import("./home")

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
