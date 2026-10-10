import { describe, expect, test } from "bun:test"
import { applyProviderVisibility, type VisibilityEntry } from "./visibility"

const openrouter = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ providerID: "openrouter", modelID: `model-${index}` }))

describe("applyProviderVisibility", () => {
  test("hides a provider in one list and leaves other providers untouched", () => {
    const anthropic = { providerID: "anthropic", modelID: "claude", visibility: "show" as const, favorite: true }
    const next = applyProviderVisibility([anthropic], openrouter(3), "hide")

    expect(next).toHaveLength(4)
    expect(next[0]).toBe(anthropic)
    expect(next.slice(1).map((item) => item.visibility)).toEqual(["hide", "hide", "hide"])
  })

  test("updates existing rows once and keeps extra fields", () => {
    const user: (VisibilityEntry & { favorite?: boolean })[] = [
      { providerID: "openrouter", modelID: "model-0", visibility: "show", favorite: true },
      { providerID: "openai", modelID: "gpt", visibility: "hide" },
      { providerID: "openrouter", modelID: "model-1", visibility: "hide" },
    ]

    const hidden = applyProviderVisibility(user, openrouter(2), "hide")
    expect(hidden[0]).toEqual({ providerID: "openrouter", modelID: "model-0", visibility: "hide", favorite: true })
    expect(hidden[1]).toBe(user[1])
    expect(hidden[2]).toBe(user[2])
    expect(hidden.filter((item) => item.providerID === "openrouter")).toHaveLength(2)

    const shown = applyProviderVisibility(hidden, openrouter(2), "show")
    expect(shown.map((item) => item.visibility)).toEqual(["show", "hide", "show"])
    expect(shown[0]).toMatchObject({ favorite: true })
  })

  test("returns the same array when the provider is already in that state", () => {
    const user = [{ providerID: "openrouter", modelID: "model-0", visibility: "hide" as const }]
    expect(applyProviderVisibility(user, openrouter(1), "hide")).toBe(user)
    expect(applyProviderVisibility(user, [], "show")).toBe(user)
  })

  test("updates the first row when a model was saved twice", () => {
    const user = [
      { providerID: "openrouter", modelID: "model-0", visibility: "show" as const },
      { providerID: "openrouter", modelID: "model-0", visibility: "show" as const },
    ]
    const next = applyProviderVisibility(user, openrouter(1), "hide")
    expect(next[0].visibility).toBe("hide")
    expect(next[1]).toBe(user[1])
  })
})
