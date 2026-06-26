import { describe, expect, test } from "bun:test"
import { modelPriceFooter, sortModelOptions } from "../../../../src/component/dialog-model"

describe("sortModelOptions", () => {
  test("orders provider-scoped model choices by newest release first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GPT 5.2", releaseDate: "2025-12-11" },
        { title: "GPT 5.4", releaseDate: "2026-03-05" },
        { title: "GPT 5.1", releaseDate: "2025-11-13" },
      ],
      true,
    )

    expect(sorted.map((model) => model.title)).toEqual(["GPT 5.4", "GPT 5.2", "GPT 5.1"])
  })

  test("preserves free-first alphabetical ordering for the regular picker", () => {
    const sorted = sortModelOptions(
      [
        { title: "Beta", releaseDate: "2026-01-01" },
        { title: "Alpha", releaseDate: "2025-01-01", footer: "Free" },
        { title: "Gamma", releaseDate: "2024-01-01", footer: "Free" },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Alpha", "Gamma", "Beta"])
  })
})

describe("modelPriceFooter", () => {
  test("formats input / output price per 1M tokens, trimming trailing zeros", () => {
    expect(modelPriceFooter("mammouth-ai", { input: 1.4, output: 4.4 })).toBe("$1.4 / $4.4")
    expect(modelPriceFooter("mammouth-ai", { input: 5, output: 25 })).toBe("$5 / $25")
    expect(modelPriceFooter("mammouth-ai", { input: 1.75, output: 14 })).toBe("$1.75 / $14")
    expect(modelPriceFooter("mammouth-ai", { input: 0.27, output: 0.4 })).toBe("$0.27 / $0.4")
  })

  test("keeps the Free label for opencode zero-cost models", () => {
    expect(modelPriceFooter("opencode", { input: 0, output: 0 })).toBe("Free")
  })

  test("shows no footer for non-opencode models without a price", () => {
    expect(modelPriceFooter("mammouth-ai", { input: 0, output: 0 })).toBeUndefined()
    expect(modelPriceFooter("mammouth-ai", undefined)).toBeUndefined()
  })
})
