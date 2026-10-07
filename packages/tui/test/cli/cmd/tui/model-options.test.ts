import { describe, expect, test } from "bun:test"
import { isFreeModel, sortModelOptions } from "../../../../src/component/model-options"

describe("isFreeModel", () => {
  test("requires every metered axis at zero", () => {
    expect(isFreeModel({ input: 0, output: 0, cache: { read: 0, write: 0 } })).toBe(true)
    expect(isFreeModel({ input: 0, output: 0 })).toBe(true)
    expect(isFreeModel(undefined)).toBe(false)
  })

  test("any nonzero meter counts as priced", () => {
    expect(isFreeModel({ input: 1, output: 0, cache: { read: 0, write: 0 } })).toBe(false)
    expect(isFreeModel({ input: 0, output: 2, cache: { read: 0, write: 0 } })).toBe(false)
    expect(isFreeModel({ input: 0, output: 0, cache: { read: 1, write: 0 } })).toBe(false)
    expect(isFreeModel({ input: 0, output: 0, cache: { read: 0, write: 1 } })).toBe(false)
  })
})

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

  test("orders regular model choices free-first and then newest-first", () => {
    const sorted = sortModelOptions(
      [
        { title: "GLM 5", releaseDate: "2025-07-28" },
        { title: "GLM 5.1", releaseDate: "2025-12-09" },
        { title: "GLM 5.2", releaseDate: "2026-02-16" },
        { title: "Free old", releaseDate: "2024-01-01", footer: "Free" },
        { title: "Free new", releaseDate: "2025-01-01", footer: "Free" },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Free new", "Free old", "GLM 5.2", "GLM 5.1", "GLM 5"])
  })
})
