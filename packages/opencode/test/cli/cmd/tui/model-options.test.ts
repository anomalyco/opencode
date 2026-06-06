import { describe, expect, test } from "bun:test"
import { sortModelOptions } from "../../../../src/cli/cmd/tui/component/dialog-model"

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
