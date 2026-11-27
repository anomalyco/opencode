import { describe, expect, test } from "bun:test"
import { buildRadarAxes, resolveRadarScore } from "../src/routes/compare-radar"
import type { ModelCatalogEntry } from "../src/routes/model-catalog"

const model: ModelCatalogEntry = {
  id: "meta/muse-spark-1.3",
  lab: "meta",
  slug: "muse-spark-1-3",
  name: "Muse Spark 1.3",
  modalities: { input: ["text", "image"], output: ["text"] },
  reasoning: true,
  toolCall: true,
  openWeights: false,
  attachment: true,
  temperature: true,
  weights: [],
  benchmarks: [],
}

function scores(entry: ModelCatalogEntry | null, catalog = [model]) {
  return Object.fromEntries(buildRadarAxes(catalog).map((axis) => [axis.label, resolveRadarScore(axis, entry)]))
}

describe("radar capability fallbacks", () => {
  test("supported capabilities have visible baselines without benchmarks", () => {
    const result = scores(model)
    expect(result["Tool use"]).toEqual({ value: 50, fallback: "Tool calling supported; no comparable benchmark" })
    expect(result.Reasoning).toEqual({ value: 50, fallback: "Reasoning supported; no comparable benchmark" })
    expect(result.Coding).toEqual({ value: 50, fallback: "No data; neutral placeholder" })
  })

  test("explicitly unsupported capabilities remain zero", () => {
    const result = scores({ ...model, reasoning: false, toolCall: false })
    expect(result["Tool use"]).toEqual({ value: 0, fallback: "Tool calling not supported" })
    expect(result.Reasoning).toEqual({ value: 0, fallback: "Reasoning not supported" })
  })

  test("unknown capabilities and unmatched models use neutral placeholders", () => {
    const result = scores({ ...model, reasoning: undefined, toolCall: undefined })
    expect(result["Tool use"]).toEqual({ value: 50, fallback: "No data; neutral placeholder" })
    expect(result.Reasoning).toEqual({ value: 50, fallback: "No data; neutral placeholder" })
    expect(Object.values(scores(null))).toEqual(Array(6).fill({ value: 50, fallback: "No data; neutral placeholder" }))
  })

  test("measured benchmark percentiles override fallbacks, including zero", () => {
    const low = {
      ...model,
      benchmarks: [
        { name: "Tau3", score: 20 },
        { name: "GPQA", score: 40 },
      ],
    }
    const high = {
      ...model,
      id: "other/model",
      benchmarks: [
        { name: "Tau3", score: 80 },
        { name: "GPQA", score: 90 },
      ],
    }
    expect(scores(low, [low, high])["Tool use"]).toEqual({ value: 0 })
    expect(scores(low, [low, high]).Reasoning).toEqual({ value: 0 })
    expect(scores(high, [low, high])["Tool use"]).toEqual({ value: 100 })
    expect(scores(high, [low, high]).Reasoning).toEqual({ value: 100 })
  })

  test("a benchmark without comparison peers retains the capability baseline", () => {
    const entry = { ...model, benchmarks: [{ name: "Tau3", score: 90 }] }
    expect(scores(entry, [entry])["Tool use"]).toEqual({
      value: 50,
      fallback: "Tool calling supported; no comparable benchmark",
    })
  })
})
