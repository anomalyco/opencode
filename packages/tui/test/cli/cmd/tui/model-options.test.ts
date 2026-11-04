import { describe, expect, test } from "bun:test"
import { go } from "fuzzysort"
import { prioritizeFavorites, sortModelOptions } from "../../../../src/component/model-options"

describe("prioritizeFavorites", () => {
  test("uses the favorite order captured when the dialog opened", () => {
    const prioritized = prioritizeFavorites(
      [
        { title: "Best match", value: { providerID: "test", modelID: "best" } },
        { title: "Favorite match", value: { providerID: "test", modelID: "favorite" } },
        { title: "Second best match", value: { providerID: "test", modelID: "second-best" } },
        { title: "Second favorite match", value: { providerID: "test", modelID: "second-favorite" } },
      ],
      new Set(["test/favorite", "test/second-favorite"]),
    )

    expect(prioritized.map((model) => model.title)).toEqual([
      "Favorite match",
      "Second favorite match",
      "Best match",
      "Second best match",
    ])
  })
})

describe("sortModelOptions", () => {
  test.each(["browse", "search", "provider"])("orders %s results free-first, keeping the given order", (mode) => {
    const options = [
      { providerID: "anthropic", title: "Claude Haiku 4.5" },
      { providerID: "opencode", title: "Claude Haiku 3" },
      { providerID: "anthropic", title: "Claude Haiku Free", free: true },
    ].map((item) => ({ ...item, providerID: mode === "provider" ? "anthropic" : item.providerID }))
    const matches = mode === "search" ? go("haik", options, { key: "title" }).map((item) => item.obj) : options
    const titles = sortModelOptions(matches, mode === "provider").map((item) => item.title)

    expect(titles[0]).toBe("Claude Haiku Free")
    expect(titles.slice(1)).toEqual(matches.map((item) => item.title).filter((title) => title !== "Claude Haiku Free"))
  })

  test("orders OpenCode Go before Zen and other providers", () => {
    const sorted = sortModelOptions([
      { providerID: "openai", providerName: "OpenAI", title: "GPT 5" },
      { providerID: "opencode", providerName: "OpenCode Zen", title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", title: "Claude Opus 4" },
      { providerID: "opencode-go", providerName: "OpenCode Go", title: "Kimi K3" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Kimi K3", "Claude Sonnet 4", "Claude Opus 4", "GPT 5"])
  })

  test("keeps ungrouped results free-first regardless of OpenCode provider", () => {
    const sorted = sortModelOptions(
      [
        { providerID: "opencode-go", title: "Go model" },
        { providerID: "opencode", title: "Free Zen model", free: true },
        { providerID: "anthropic", title: "Anthropic model" },
      ],
      false,
    )

    expect(sorted.map((model) => model.title)).toEqual(["Free Zen model", "Go model", "Anthropic model"])
  })

  test("orders provider groups by provider name and keeps the server's order within each", () => {
    const sorted = sortModelOptions([
      { providerID: "google", providerName: "Google", title: "Gemini 2.5 Pro" },
      { providerID: "anthropic", providerName: "Anthropic", title: "Claude Opus 4" },
      { providerID: "openai", providerName: "OpenAI", title: "GPT 5" },
      { providerID: "anthropic", providerName: "Anthropic", title: "Claude Sonnet 4" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Opus 4", "Claude Sonnet 4", "Gemini 2.5 Pro", "GPT 5"])
  })

  test("keeps the server's order when titles and release dates would sort differently", () => {
    const sorted = sortModelOptions([
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 5, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 9, title: "Claude Opus 4" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Sonnet 4", "Claude Opus 4"])
  })

  test("preserves the server's order for free OpenCode models", () => {
    // `Model.available()` puts the preferred free models first, then the rest newest-first.
    const serverOrder = [
      "Big Pickle",
      "DeepSeek V4.1 Flash Free",
      "GLM-5.3-Flash Free",
      "MiniMax M3.1 Flash Free",
      "Nemotron 3.5 Super VL Free",
    ]
    const options = serverOrder.map((title, index) => ({
      value: { providerID: "opencode", modelID: title.toLowerCase().replaceAll(" ", "-") },
      providerID: "opencode",
      providerName: "OpenCode Zen",
      releaseDate: index === 0 ? 1000 : 5000 - index,
      title,
      free: true,
    }))

    expect(sortModelOptions(options, false).map((model) => model.title)).toEqual(serverOrder)
    expect(sortModelOptions(options, true).map((model) => model.title)).toEqual(serverOrder)
  })
})
