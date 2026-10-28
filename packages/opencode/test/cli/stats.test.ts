import { describe, expect, it } from "bun:test"
import { cacheSummary, toStatsJson, type SessionStats } from "../../src/cli/cmd/stats"

const empty: SessionStats = {
  totalSessions: 0,
  totalMessages: 0,
  totalCost: 0,
  totalTokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  toolUsage: {},
  modelUsage: {},
  dateRange: { earliest: 0, latest: 0 },
  days: 0,
  costPerDay: 0,
  tokensPerSession: 0,
  medianTokensPerSession: 0,
}

const populated: SessionStats = {
  totalSessions: 2,
  totalMessages: 10,
  totalCost: 1.25,
  totalTokens: {
    input: 1000,
    output: 200,
    reasoning: 50,
    cache: { read: 300, write: 0 },
  },
  toolUsage: { bash: 3, read: 5 },
  modelUsage: {
    "deepseek/deepseek-flash": {
      messages: 4,
      cost: 0.5,
      tokens: { input: 600, output: 120, cache: { read: 200, write: 0 } },
    },
    "anthropic/claude": {
      messages: 6,
      cost: 0.75,
      tokens: { input: 400, output: 80, cache: { read: 100, write: 0 } },
    },
  },
  dateRange: {
    earliest: Date.parse("2026-10-01T00:00:00.000Z"),
    latest: Date.parse("2026-10-03T00:00:00.000Z"),
  },
  days: 3,
  costPerDay: 0.4166666666666667,
  tokensPerSession: 775,
  medianTokensPerSession: 775,
}

describe("stats JSON", () => {
  it("emits a versioned empty report", () => {
    const report = toStatsJson(empty, { now: new Date("2026-10-24T12:00:00.000Z") })
    expect(report.schemaVersion).toBe(1)
    expect(report.generatedAt).toBe("2026-10-24T12:00:00.000Z")
    expect(report.filters).toEqual({ days: null, project: { mode: "all", id: null } })
    expect(report.range).toEqual({ days: 0, earliest: null, latest: null })
    expect(report.totals).toEqual({
      sessions: 0,
      messages: 0,
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0, miss: 0, totalInput: 0, hitRate: 0 },
      },
    })
    expect(report.models).toEqual([])
    expect(report.tools).toEqual([])
  })

  it("derives cache miss and hit rate from non-cached input", () => {
    expect(cacheSummary({ input: 200, cache: { read: 800, write: 0 } })).toEqual({
      read: 800,
      write: 0,
      miss: 200,
      totalInput: 1000,
      hitRate: 0.8,
    })
    expect(cacheSummary({ input: 0, cache: { read: 0, write: 0 } }).hitRate).toBe(0)
  })

  it("emits totals, filters, ISO dates, and deterministic ordering", () => {
    const report = toStatsJson(populated, {
      days: 7,
      project: "",
      currentProjectID: "proj_current",
      now: new Date("2026-10-24T12:00:00.000Z"),
    })
    expect(report.filters).toEqual({ days: 7, project: { mode: "current", id: "proj_current" } })
    expect(report.range).toEqual({
      days: 3,
      earliest: "2026-10-01T00:00:00.000Z",
      latest: "2026-10-03T00:00:00.000Z",
    })
    expect(report.totals.tokens).toMatchObject({
      input: 1000,
      output: 200,
      reasoning: 50,
      cache: { read: 300, write: 0, miss: 1000, totalInput: 1300 },
    })
    expect(report.totals.tokens.cache.hitRate).toBeCloseTo(300 / 1300, 10)
    expect(report.models.map((model) => model.id)).toEqual(["anthropic/claude", "deepseek/deepseek-flash"])
    expect(report.tools).toEqual([
      { name: "read", count: 5 },
      { name: "bash", count: 3 },
    ])
  })

  it("supports id and all project filters", () => {
    expect(toStatsJson(empty, { project: "proj_1" }).filters.project).toEqual({
      mode: "id",
      id: "proj_1",
    })
    expect(toStatsJson(empty).filters.project).toEqual({ mode: "all", id: null })
  })

  it("sanitizes non-finite numbers", () => {
    const report = toStatsJson(
      {
        ...empty,
        totalCost: Number.NaN,
        costPerDay: Number.POSITIVE_INFINITY,
        modelUsage: {
          "test/model": {
            messages: Number.NaN,
            cost: Number.NaN,
            tokens: {
              input: Number.NaN,
              output: Number.POSITIVE_INFINITY,
              cache: { read: Number.NaN, write: Number.NaN },
            },
          },
        },
      },
      { days: Number.NaN },
    )
    expect(report.filters.days).toBe(null)
    expect(report.totals.cost).toBe(0)
    expect(report.averages.costPerDay).toBe(0)
    expect(report.models[0]).toEqual({
      id: "test/model",
      messages: 0,
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0, miss: 0, totalInput: 0, hitRate: 0 },
      },
    })
  })

  it("does not throw on invalid session timestamps", () => {
    const report = toStatsJson({
      ...empty,
      totalSessions: 1,
      dateRange: { earliest: Number.NaN, latest: Number.POSITIVE_INFINITY },
    })
    expect(report.range.earliest).toBe(null)
    expect(report.range.latest).toBe(null)
  })
})
