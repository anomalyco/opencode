import { describe, expect, test } from "bun:test"
import { buildLiteUsageBreakdown, getModelQuotaLimit } from "../src/lib/lite-usage"

describe("Go usage breakdown", () => {
  test("derives the model quota from the window limit and multiplier", () => {
    expect(getModelQuotaLimit(30, 1)).toBe(30)
    expect(getModelQuotaLimit(30, 2)).toBe(15)
    expect(getModelQuotaLimit(30, 4)).toBe(7.5)
  })

  test("groups model quota usage into the percentage of the limit", () => {
    const result = buildLiteUsageBreakdown({
      usage: 416,
      limit: 1_200,
      sources: [
        { model: "glm", name: "GLM", cost: 200, quotaCost: 300, multiplier: 1.5, estimated: false },
        { model: "kimi", name: "Kimi", cost: 116, quotaCost: 116, multiplier: 1, estimated: false },
      ],
    })

    expect(result.usagePercent).toBe(34.7)
    expect(result.rows[0]).toMatchObject({ name: "GLM", multiplier: 1.5, contributionPercent: 25 })
    expect(result.rows.reduce((total, row) => total + row.contributionPercent, 0)).toBeCloseTo(result.usagePercent)
  })

  test("distributes credits across the model contributions", () => {
    const result = buildLiteUsageBreakdown({
      usage: 366,
      limit: 1_200,
      sources: [
        { model: "glm", name: "GLM", cost: 200, quotaCost: 300, multiplier: 1.5, estimated: false },
        { model: "kimi", name: "Kimi", cost: 116, quotaCost: 116, multiplier: 1, estimated: true },
      ],
    })

    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((row) => row.contributionPercent >= 0)).toBe(true)
    expect(result.rows.reduce((total, row) => total + row.contributionPercent, 0)).toBeCloseTo(result.usagePercent)
  })

  test("does not synthesize a row when request history is unavailable", () => {
    const result = buildLiteUsageBreakdown({ usage: 120, limit: 1_200, sources: [] })

    expect(result.rows).toEqual([])
  })

  test("allocates rounded percentages without making positive rows negative", () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({
      model: `model-${index}`,
      name: `Model ${index}`,
      cost: 4,
      quotaCost: 4,
      multiplier: 1,
      estimated: false,
    }))
    const result = buildLiteUsageBreakdown({ usage: 80, limit: 10_000, sources })

    expect(result.rows.every((row) => row.contributionPercent >= 0)).toBe(true)
    expect(result.rows.reduce((total, row) => total + row.contributionPercent, 0)).toBeCloseTo(result.usagePercent)
  })

  test("keeps multiplier changes for the same model as separate rows", () => {
    const result = buildLiteUsageBreakdown({
      usage: 500,
      limit: 1_000,
      sources: [
        { model: "glm", name: "GLM", cost: 100, quotaCost: 100, multiplier: 1, estimated: false },
        { model: "glm", name: "GLM", cost: 200, quotaCost: 400, multiplier: 2, estimated: false },
      ],
    })

    expect(result.rows.map((row) => row.multiplier)).toEqual([2, 1])
    expect(result.rows.map((row) => row.contributionPercent)).toEqual([40, 10])
  })

  test.each([false, true])("merges same-rate usage (estimated first: %s)", (estimated) => {
    const sources = [
      { model: "deepseek-v4-flash", name: "DeepSeek V4 Flash", cost: 200, quotaCost: 400, multiplier: 2, estimated },
      { model: "other", name: "Other", cost: 500, quotaCost: 500, multiplier: 1, estimated: false },
      {
        model: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        cost: 100,
        quotaCost: 199,
        multiplier: 2,
        estimated: !estimated,
      },
    ]
    const original = structuredClone(sources)
    const result = buildLiteUsageBreakdown({ usage: 1_050, limit: 6_000, sources })

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      model: "deepseek-v4-flash",
      cost: 300,
      quotaCost: 599,
      multiplier: 2,
      estimated: true,
    })
    expect(getModelQuotaLimit(result.limit, result.rows[0].multiplier)).toBe(3_000)
    expect(result.usage).toBe(1_050)
    expect(result.usagePercent).toBe(17.5)
    expect(result.rows.reduce((total, row) => total + row.contributionPercent, 0)).toBeCloseTo(result.usagePercent)
    expect(sources).toEqual(original)
  })

  test("keeps distinct model IDs with the same display name separate", () => {
    const result = buildLiteUsageBreakdown({
      usage: 300,
      limit: 1_000,
      sources: [
        { model: "first", name: "Model", cost: 100, quotaCost: 100, multiplier: 1, estimated: false },
        { model: "second", name: "Model", cost: 200, quotaCost: 200, multiplier: 1, estimated: false },
      ],
    })

    expect(result.rows.map((row) => row.model)).toEqual(["second", "first"])
  })

  test("does not merge unknown rates with recorded rates", () => {
    const result = buildLiteUsageBreakdown({
      usage: 300,
      limit: 1_000,
      sources: [
        { model: "glm", name: "GLM", cost: 100, quotaCost: 100, estimated: true },
        { model: "glm", name: "GLM", cost: 200, quotaCost: 200, multiplier: 1, estimated: false },
      ],
    })

    expect(result.rows.map((row) => row.multiplier)).toEqual([1, undefined])
    expect(getModelQuotaLimit(result.limit, result.rows[1].multiplier)).toBeUndefined()
  })
})
