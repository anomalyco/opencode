import { describe, expect, test } from "bun:test"
import type { RetentionMetricRow } from "./home"

process.env.SST_RESOURCE_App = JSON.stringify({ name: "opencode", stage: "test" })
process.env.SST_RESOURCE_StatsDatabase = JSON.stringify({ url: "mysql://localhost/stats" })

const { buildRetentionEntries } = await import("./home")

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
