import { describe, expect, test } from "bun:test"
import { buildProviderOptions, buildSectionOptions } from "../../../src/cli/cmd/tui/component/dialog-model-utils"

function provider(id: string, name: string, models: Record<string, { id: string; name?: string; status?: string; providerID?: string; cost?: { input?: number } }>) {
  return { id, name, models }
}

describe("dialog-model", () => {
  test("models in recents still appear in provider groups", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
      }),
    ]
    const recents = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]

    const recentOptions = buildSectionOptions({
      items: recents,
      category: "Recent",
      providers,
      showSections: true,
    })
    const providerOptions = buildProviderOptions({
      providers,
      favorites: [],
      connected: true,
    })

    expect(recentOptions).toHaveLength(1)
    expect(providerOptions.map((x) => x.value)).toContainEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
  })

  test("section options have unique values with section discriminator", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
      }),
    ]
    const favorites = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]
    const recents = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]

    const favoriteOptions = buildSectionOptions({ items: favorites, category: "Favorites", providers, showSections: true })
    const recentOptions = buildSectionOptions({ items: recents, category: "Recent", providers, showSections: true })
    const providerOptions = buildProviderOptions({ providers, favorites, connected: true })

    // Section items must not share value identity with provider items
    const providerValue = providerOptions[0]?.value
    const favoriteValue = favoriteOptions[0]?.value
    const recentValue = recentOptions[0]?.value
    expect(favoriteValue).not.toEqual(providerValue)
    expect(recentValue).not.toEqual(providerValue)
    expect(favoriteValue).not.toEqual(recentValue)

    // Section values carry the section discriminator
    expect(favoriteValue).toMatchObject({ providerID: "anthropic", modelID: "claude-3-5-sonnet", section: "Favorites" })
    expect(recentValue).toMatchObject({ providerID: "anthropic", modelID: "claude-3-5-sonnet", section: "Recent" })

    // Provider values remain plain
    expect(providerValue).toEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
  })

  test("models in favorites still appear in provider groups", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
      }),
    ]
    const favorites = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]

    const result = buildProviderOptions({
      providers,
      favorites,
      connected: true,
    })

    expect(result.map((x) => x.value)).toContainEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    expect(result[0]?.description).toBe("(Favorite)")
  })

  test("models in both recents and favorites still appear in provider groups", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
      }),
    ]
    const favorites = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]
    const recents = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]

    const recentOptions = buildSectionOptions({
      items: recents,
      category: "Recent",
      providers,
      showSections: true,
    })
    const providerOptions = buildProviderOptions({
      providers,
      favorites,
      connected: true,
    })

    expect(recentOptions).toHaveLength(1)
    expect(providerOptions.map((x) => x.value)).toContainEqual({ providerID: "anthropic", modelID: "claude-3-5-sonnet" })
    expect(providerOptions[0]?.description).toBe("(Favorite)")
  })

  test("empty recents and favorites keeps all provider models", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
      }),
      provider("openai", "OpenAI", {
        "gpt-4o": { id: "gpt-4o", name: "GPT-4o", providerID: "openai" },
      }),
    ]

    const result = buildProviderOptions({
      providers,
      favorites: [],
      connected: true,
    })

    expect(result.map((x) => x.value)).toEqual([
      { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
      { providerID: "openai", modelID: "gpt-4o" },
    ])
  })

  test("deprecated models are excluded from provider groups", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
        "claude-2": { id: "claude-2", name: "Claude 2", providerID: "anthropic", status: "deprecated" },
      }),
    ]

    const result = buildProviderOptions({
      providers,
      favorites: [],
      connected: true,
    })

    expect(result.map((x) => x.value)).toEqual([{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }])
  })

  test("provider ordering keeps opencode first then alphabetical", () => {
    const providers = [
      provider("zeta", "Zeta", {
        "zeta-model": { id: "zeta-model", providerID: "zeta" },
      }),
      provider("opencode", "OpenCode", {
        "opencode-base": { id: "opencode-base", providerID: "opencode", cost: { input: 0 } },
      }),
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", providerID: "anthropic" },
      }),
    ]

    const result = buildProviderOptions({
      providers,
      favorites: [],
      connected: true,
    })

    expect(result.map((x) => x.category)).toEqual(["OpenCode", "Anthropic", "Zeta"])
    expect(result[0]?.footer).toBe("Free")
  })

  test("all composed option values produce unique JSON.stringify ids (no duplicate DOM ids)", () => {
    const providers = [
      provider("anthropic", "Anthropic", {
        "claude-3-5-sonnet": { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", providerID: "anthropic" },
        "claude-3-opus": { id: "claude-3-opus", name: "Claude 3 Opus", providerID: "anthropic" },
      }),
      provider("openai", "OpenAI", {
        "gpt-4o": { id: "gpt-4o", name: "GPT-4o", providerID: "openai" },
      }),
    ]
    const favorites = [{ providerID: "anthropic", modelID: "claude-3-5-sonnet" }]
    const recents = [
      { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
      { providerID: "openai", modelID: "gpt-4o" },
    ]

    const favoriteOptions = buildSectionOptions({ items: favorites, category: "Favorites", providers, showSections: true })
    const recentOptions = buildSectionOptions({
      items: recents.filter((r) => !favorites.some((f) => f.providerID === r.providerID && f.modelID === r.modelID)),
      category: "Recent",
      providers,
      showSections: true,
    })
    const providerOptions = buildProviderOptions({ providers, favorites, connected: true })

    const all = [...favoriteOptions, ...recentOptions, ...providerOptions]
    const ids = all.map((o) => JSON.stringify(o.value))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
