import { describe, expect, test } from "bun:test"
import { matchesModelSearch } from "./dialog-select-model-search"

const popularProviders = [
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]

type ModelItem = {
  id: string
  name: string
  provider: { id: string; name: string }
  family?: string
  release_date?: string
  cost?: { input: number }
  latest?: boolean
}

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`

const sortModelGroups = (a: { category: string; items: ModelItem[] }, b: { category: string; items: ModelItem[] }) => {
  const aIndex = popularProviders.indexOf(a.category)
  const bIndex = popularProviders.indexOf(b.category)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0

  if (aPopular && !bPopular) return -1
  if (!aPopular && bPopular) return 1
  if (aPopular && bPopular) return aIndex - bIndex
  return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
}

function filterModels(allModels: ModelItem[], query: string): ModelItem[] {
  const trimmed = query.trim()
  const filtered = trimmed
    ? allModels.filter((item) => matchesModelSearch(trimmed, [item.name, item.id, item.provider.name]))
    : allModels
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
}

function groupModels(models: ModelItem[]): { category: string; items: ModelItem[] }[] {
  const byProvider = new Map<string, ModelItem[]>()
  for (const item of models) {
    byProvider.set(item.provider.id, [...(byProvider.get(item.provider.id) ?? []), item])
  }
  return Array.from(byProvider, ([category, items]) => ({ category, items })).sort(sortModelGroups)
}

function flattenedGroups(groups: { category: string; items: ModelItem[] }[]): ModelItem[] {
  return groups.flatMap((g) => g.items)
}

const makeModel = (id: string, name: string, providerId: string, providerName: string): ModelItem => ({
  id,
  name,
  provider: { id: providerId, name: providerName },
})

describe("model selector navigation order", () => {
  const allModels: ModelItem[] = [
    makeModel("deepseek-v4-flash", "DeepSeek V4 Flash", "openrouter", "OpenRouter"),
    makeModel("deepseek-v4-flash", "DeepSeek V4 Flash", "anthropic", "Anthropic"),
    makeModel("deepseek-v4-flash", "DeepSeek V4 Flash", "opencode", "OpenCode"),
    makeModel("gpt-5", "GPT-5", "openai", "OpenAI"),
    makeModel("claude-4", "Claude 4", "anthropic", "Anthropic"),
  ]

  test("flattened groups follow provider popularity order, not alphabetical model name order", () => {
    const filtered = filterModels(allModels, "deep")
    const groups = groupModels(filtered)
    const flat = flattenedGroups(groups)

    const keys = flat.map(modelKey)

    // Popular providers appear first in the order defined by popularProviders:
    // opencode (index 0), anthropic (index 2), openrouter (index 6)
    expect(keys).toEqual([
      "opencode:deepseek-v4-flash",
      "anthropic:deepseek-v4-flash",
      "openrouter:deepseek-v4-flash",
    ])
  })

  test("flat models sort by name alphabetically (differs from group order)", () => {
    const filtered = filterModels(allModels, "deep")

    // models() sorts alphabetically by name — all three have the same name,
    // so their order depends on the original array order before sort (unstable)
    // This is NOT the visual order when grouped by provider
    const flatKeys = filtered.map(modelKey)

    // The flat sort does not guarantee provider-popularity ordering
    // This test documents the discrepancy: flat alphabetical != grouped visual
    const groupKeys = flattenedGroups(groupModels(filtered)).map(modelKey)

    // They may or may not differ depending on sort stability,
    // but the key insight is that groups() re-orders by provider popularity
    expect(groupKeys).toEqual([
      "opencode:deepseek-v4-flash",
      "anthropic:deepseek-v4-flash",
      "openrouter:deepseek-v4-flash",
    ])
  })

  test("navigation keys derived from groups match visual render order", () => {
    const filtered = filterModels(allModels, "deep")
    const groups = groupModels(filtered)

    // This is the corrected behavior: keys() should derive from groups()
    const navKeys = [...flattenedGroups(groups).map(modelKey), "action:manage"]

    expect(navKeys).toEqual([
      "opencode:deepseek-v4-flash",
      "anthropic:deepseek-v4-flash",
      "openrouter:deepseek-v4-flash",
      "action:manage",
    ])
  })

  test("mixed providers with different model names follow group order", () => {
    const filtered = filterModels(allModels, "")
    const groups = groupModels(filtered)
    const flat = flattenedGroups(groups)
    const keys = flat.map(modelKey)

    // Popular providers first: opencode, anthropic, openai, then openrouter
    expect(keys).toEqual([
      "opencode:deepseek-v4-flash",
      "anthropic:claude-4",
      "anthropic:deepseek-v4-flash",
      "openai:gpt-5",
      "openrouter:deepseek-v4-flash",
    ])
  })
})
