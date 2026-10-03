import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import { selectLatest } from "./model-latest"

function item(providerID: string, modelID: string, opts: { family?: string; monthsAgo?: number } = {}) {
  const release = DateTime.now().minus({ months: opts.monthsAgo ?? 1 })
  return {
    model: { id: modelID, family: opts.family, release_date: release.toISO() ?? "", provider: { id: providerID } },
    release: [`${providerID}:${modelID}`, release] as const,
  }
}

function latestOf(parts: ReturnType<typeof item>[]) {
  return selectLatest(
    parts.map((p) => p.model),
    new Map(parts.map((p) => p.release)),
  )
}

describe("selectLatest", () => {
  test("includes a recent model without family", () => {
    const result = latestOf([item("opencode-go", "omen-alpha")])
    expect(result).toEqual([{ providerID: "opencode-go", modelID: "omen-alpha" }])
  })

  test("keeps every recent model without family from the same provider", () => {
    const result = latestOf([item("opencode-go", "omen-alpha"), item("opencode-go", "omen-beta")])
    expect(result).toContainEqual({ providerID: "opencode-go", modelID: "omen-alpha" })
    expect(result).toContainEqual({ providerID: "opencode-go", modelID: "omen-beta" })
  })

  test("keeps a family-less model whose id matches another model's family", () => {
    const result = latestOf([item("anthropic", "claude"), item("anthropic", "claude-sonnet", { family: "claude" })])
    expect(result).toContainEqual({ providerID: "anthropic", modelID: "claude" })
    expect(result).toContainEqual({ providerID: "anthropic", modelID: "claude-sonnet" })
  })

  test("keeps a family-less model when another family contains a null byte", () => {
    const result = latestOf([item("acme", "foo"), item("acme", "bar", { family: "\0foo" })])
    expect(result).toContainEqual({ providerID: "acme", modelID: "foo" })
    expect(result).toContainEqual({ providerID: "acme", modelID: "bar" })
  })

  test("keeps only the newest model per family", () => {
    const result = latestOf([
      item("anthropic", "claude-old", { family: "claude", monthsAgo: 2 }),
      item("anthropic", "claude-new", { family: "claude", monthsAgo: 1 }),
    ])
    expect(result).toEqual([{ providerID: "anthropic", modelID: "claude-new" }])
  })

  test("excludes models older than six months, with or without family", () => {
    const result = latestOf([
      item("opencode-go", "omen-legacy", { monthsAgo: 12 }),
      item("anthropic", "claude-legacy", { family: "claude", monthsAgo: 12 }),
    ])
    expect(result).toEqual([])
  })
})
