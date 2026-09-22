import { describe, expect, test } from "bun:test"
import { searchModelOptions, sortModelOptions } from "../../../../src/component/dialog-model"

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

describe("searchModelOptions", () => {
  const category = "OpenRouter"
  // Titles from a real OpenRouter catalogue, in the order the picker lists them.
  const options = [
    { title: "inclusionai/ling-3.0-flash", category, releaseDate: "2026-09-01" },
    { title: "inclusionai/ling-3.0-flash-vl", category, releaseDate: "2026-09-01" },
    { title: "openai/gpt-5.6-luna", category, releaseDate: "2026-08-01" },
    { title: "openai/gpt-5.6-luna-pro", category, releaseDate: "2026-08-01" },
    { title: "poolside/laguna-s-2.1", category, releaseDate: "2026-07-01" },
    { title: "~openai/gpt-luna-latest", category, releaseDate: "2026-06-01" },
  ]

  test("ranks names containing the query above scattered-letter matches", () => {
    const titles = searchModelOptions("luna", options).map((option) => option.title)
    const exact = titles.filter((title) => title.includes("luna"))

    // Every name that literally contains "luna" comes before any that only match
    // its letters in order, like incLUsioNAi or LagUNA.
    expect(titles.slice(0, exact.length)).toEqual(exact)
    expect(exact).toHaveLength(3)
  })

  test("does not re-sort search results by release date", () => {
    const titles = searchModelOptions("luna", options).map((option) => option.title)
    expect(titles[0]).not.toBe("inclusionai/ling-3.0-flash")
  })
})
