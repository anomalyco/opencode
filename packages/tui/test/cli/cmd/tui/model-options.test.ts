import { describe, expect, test } from "bun:test"
import { sortModelOptions } from "../../../../src/component/dialog-model"

describe("sortModelOptions", () => {
  test("orders opencode models before other providers", () => {
    const sorted = sortModelOptions([
      { providerID: "openai", providerName: "OpenAI", releaseDate: 3, title: "GPT 5" },
      { providerID: "opencode", providerName: "OpenCode", releaseDate: 1, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 2, title: "Claude Opus 4" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Sonnet 4", "Claude Opus 4", "GPT 5"])
  })

  test("orders provider groups by provider name and models by newest release", () => {
    const sorted = sortModelOptions([
      { providerID: "google", providerName: "Google", releaseDate: 5, title: "Gemini 2.5 Pro" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 4, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 6, title: "Claude Opus 4" },
      { providerID: "openai", providerName: "OpenAI", releaseDate: 7, title: "GPT 5" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Opus 4", "Claude Sonnet 4", "Gemini 2.5 Pro", "GPT 5"])
  })

  test("falls back to title when release dates match within a provider", () => {
    const sorted = sortModelOptions([
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 5, title: "Claude Sonnet 4" },
      { providerID: "anthropic", providerName: "Anthropic", releaseDate: 5, title: "Claude Opus 4" },
    ])

    expect(sorted.map((model) => model.title)).toEqual(["Claude Opus 4", "Claude Sonnet 4"])
  })
})
