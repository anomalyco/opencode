import { describe, expect, test } from "bun:test"
import { resolveThemeFallback } from "../../../src/cli/cmd/tui/context/local"

describe("resolveThemeFallback", () => {
  const providers = [
    {
      id: "anthropic",
      theme: "provider-theme",
      models: {
        "claude-sonnet": { theme: "model-theme" },
        "claude-opus": {}
      }
    },
    {
      id: "openai",
      models: {
        "gpt-4": {},
        "gpt-4.1": { theme: "model-theme"}
      }
    }
  ]

  test("returns model theme when available", () => {
    const theme = resolveThemeFallback({ providerID: "anthropic", modelID: "claude-sonnet" }, providers, "tui-theme")
    expect(theme).toBe("model-theme")
  })

  test("returns model theme when available", () => {
    const theme = resolveThemeFallback({ providerID: "openai", modelID: "gpt-4.1" }, providers, "tui-theme")
    expect(theme).toBe("model-theme")
  })

  test("falls back to provider theme when model theme missing", () => {
    const theme = resolveThemeFallback({ providerID: "anthropic", modelID: "claude-opus" }, providers, "tui-theme")
    expect(theme).toBe("provider-theme")
  })

  test("falls back to tui theme when provider theme missing", () => {
    const theme = resolveThemeFallback({ providerID: "openai", modelID: "gpt-4" }, providers, "tui-theme")
    expect(theme).toBe("tui-theme")
  })

  test("falls back to default opencode theme when tui theme missing", () => {
    const theme = resolveThemeFallback({ providerID: "openai", modelID: "gpt-4" }, providers, undefined)
    expect(theme).toBe("opencode")
  })

  test("falls back to tui theme if model is undefined", () => {
    const theme = resolveThemeFallback(undefined, providers, "tui-theme")
    expect(theme).toBe("tui-theme")
  })

  test("falls back to tui theme if provider not found", () => {
    const theme = resolveThemeFallback({ providerID: "unknown", modelID: "unknown" }, providers, "tui-theme")
    expect(theme).toBe("tui-theme")
  })
})
