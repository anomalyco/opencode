import { describe, expect, test } from "bun:test"
import type { Model, Provider } from "@opencode-ai/sdk/v2"
import { createModelPickerOptions, sortModelOptions } from "../../../../src/component/dialog-model"

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

describe("createModelPickerOptions", () => {
  test("keeps search data flat by default", () => {
    const options = createModelPickerOptions({
      query: "claude",
      connected: true,
      groupSearchResults: false,
      providers: modelProviders,
      favorites: [{ providerID: "anthropic", modelID: "claude-sonnet" }],
      recents: [{ providerID: "anthropic", modelID: "claude-haiku" }],
      popularProviders: [],
      onSelect: () => {},
    })

    expect(options.map((option) => [option.category, option.title])).toEqual([
      ["Anthropic", "Claude Opus"],
      ["Anthropic", "Claude Haiku"],
      ["Anthropic", "Claude Sonnet"],
    ])
    expect(options.some((option) => option.category === "Favorites" || option.category === "Recent")).toBe(false)
  })

  test("keeps favorites and recents grouped while searching", () => {
    const options = createModelPickerOptions({
      query: "claude",
      connected: true,
      groupSearchResults: true,
      providers: modelProviders,
      favorites: [{ providerID: "anthropic", modelID: "claude-sonnet" }],
      recents: [
        { providerID: "anthropic", modelID: "claude-sonnet" },
        { providerID: "anthropic", modelID: "claude-haiku" },
      ],
      popularProviders: [],
      onSelect: () => {},
    })

    expect(options.map((option) => [option.category, option.title])).toEqual([
      ["Favorites", "Claude Sonnet"],
      ["Recent", "Claude Haiku"],
      ["Anthropic", "Claude Opus"],
    ])
  })

  test("matches provider names during grouped search", () => {
    const options = createModelPickerOptions({
      query: "anthropic",
      connected: true,
      groupSearchResults: true,
      providers: modelProviders,
      favorites: [{ providerID: "anthropic", modelID: "claude-sonnet" }],
      recents: [{ providerID: "anthropic", modelID: "claude-haiku" }],
      popularProviders: [],
      onSelect: () => {},
    })

    expect(options.map((option) => [option.category, option.title])).toEqual([
      ["Favorites", "Claude Sonnet"],
      ["Recent", "Claude Haiku"],
      ["Anthropic", "Claude Opus"],
    ])
  })
})

const modelProviders = [
  provider("anthropic", "Anthropic", [
    model("anthropic", "claude-sonnet", "Claude Sonnet", "2026-01-01"),
    model("anthropic", "claude-haiku", "Claude Haiku", "2026-01-02"),
    model("anthropic", "claude-opus", "Claude Opus", "2026-01-03"),
  ]),
]

function provider(id: string, name: string, models: Model[]): Provider {
  return {
    id,
    name,
    source: "api",
    env: [],
    options: {},
    models: Object.fromEntries(models.map((model) => [model.id, model])),
  }
}

function model(providerID: string, id: string, name: string, releaseDate: string): Model {
  return {
    id,
    providerID,
    api: {
      id: "test",
      url: "https://example.com",
      npm: "test",
    },
    name,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 1,
      output: 1,
      cache: {
        read: 1,
        write: 1,
      },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: releaseDate,
  }
}
