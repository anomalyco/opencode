import { describe, expect, test } from "bun:test"
import { normalizeCustomProviderID, providerOptions } from "../../../../src/cli/cmd/tui/component/dialog-provider"

describe("providerOptions", () => {
  test("includes a synthetic Other option for custom providers", () => {
    expect(providerOptions([{ id: "openai", name: "OpenAI" }]).at(-1)).toMatchObject({
      title: "Other",
      description: "Custom provider",
      category: "Providers",
    })
  })

  test("does not use Other as the generic provider category", () => {
    expect(providerOptions([{ id: "mistral", name: "Mistral" }])[0]?.category).toBe("Providers")
  })

  test("sorts popular providers first in defined order, then rest alphabetically, and keeps Other last", () => {
    const options = providerOptions([
      { id: "openai", name: "OpenAI" },
      { id: "custom-z", name: "Zebra Provider" },
      { id: "anthropic", name: "Anthropic" },
      { id: "google", name: "Google" },
      { id: "mistral", name: "Mistral" },
      { id: "aws", name: "AWS Bedrock" },
    ])

    expect(options.map((option) => option.value)).toEqual([
      // Popular providers in defined order
      "anthropic",
      "openai",
      "google",
      // Non-popular providers sorted alphabetically by name
      "aws",
      "mistral",
      "custom-z",
      // Other always last
      "__opencode_custom_provider__",
    ])
  })

  test("assigns Popular category to popular providers and Providers to others", () => {
    const options = providerOptions([
      { id: "openai", name: "OpenAI" },
      { id: "mistral", name: "Mistral" },
    ])

    const openai = options.find((o) => o.value === "openai")
    const mistral = options.find((o) => o.value === "mistral")

    expect(openai?.category).toBe("Popular")
    expect(mistral?.category).toBe("Providers")
  })

  test("does not collide with a configured provider named other", () => {
    const values = providerOptions([{ id: "other", name: "Other Provider" }]).map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  test("normalizes and validates custom provider ids", () => {
    expect(normalizeCustomProviderID("  custom-provider  ")).toBe("custom-provider")
    expect(normalizeCustomProviderID("custom_provider")).toBe("custom_provider")
    expect(normalizeCustomProviderID("@ai-sdk/custom-provider")).toBe("custom-provider")
    expect(normalizeCustomProviderID("-custom-provider")).toBeUndefined()
    expect(normalizeCustomProviderID("Custom Provider")).toBeUndefined()
  })
})
