import { test, expect, describe } from "bun:test"
import { resolveConfigProviders, resolvePluginProviders } from "../../src/cli/cmd/providers"
import type { Hooks } from "@opencode-ai/plugin"

function hookWithAuth(provider: string): Hooks {
  return {
    auth: {
      provider,
      methods: [],
    },
  }
}

function hookWithoutAuth(): Hooks {
  return {}
}

describe("resolvePluginProviders", () => {
  test("returns plugin providers not in models.dev", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips providers already in models.dev", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("anthropic")],
      existingProviders: { anthropic: {} },
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("deduplicates across plugins", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey"), hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("respects disabled_providers", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("respects enabled_providers when provider is absent", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["anthropic"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("includes provider when in enabled set", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("resolves name from providerNames", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: { portkey: "Portkey AI" },
    })
    expect(result).toEqual([{ id: "portkey", name: "Portkey AI" }])
  })

  test("falls back to id when no name configured", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips hooks without auth", () => {
    const result = resolvePluginProviders({
      hooks: [hookWithoutAuth(), hookWithAuth("portkey"), hookWithoutAuth()],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("returns empty for no hooks", () => {
    const result = resolvePluginProviders({
      hooks: [],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })
})

describe("resolveConfigProviders", () => {
  test("returns providers with config api keys", () => {
    const result = resolveConfigProviders({
      config: {
        provider: {
          anthropic: {
            options: {
              apiKey: "test-key",
            },
          },
          openai: {
            name: "OpenAI Custom",
            options: {
              apiKey: "test-openai-key",
            },
          },
          google: {
            options: {},
          },
        },
      },
      database: {
        anthropic: { name: "Anthropic" },
        openai: { name: "OpenAI" },
        google: { name: "Google" },
      },
      existing: new Set(),
    })

    expect(result).toEqual([
      { id: "anthropic", name: "Anthropic" },
      { id: "openai", name: "OpenAI Custom" },
    ])
  })

  test("respects enabled and disabled providers", () => {
    const result = resolveConfigProviders({
      config: {
        enabled_providers: ["openai"],
        disabled_providers: ["anthropic"],
        provider: {
          anthropic: {
            options: {
              apiKey: "test-key",
            },
          },
          openai: {
            options: {
              apiKey: "test-openai-key",
            },
          },
        },
      },
      database: {
        anthropic: { name: "Anthropic" },
        openai: { name: "OpenAI" },
      },
      existing: new Set(),
    })

    expect(result).toEqual([{ id: "openai", name: "OpenAI" }])
  })

  test("skips providers already present in auth credentials", () => {
    const result = resolveConfigProviders({
      config: {
        provider: {
          anthropic: {
            options: {
              apiKey: "test-key",
            },
          },
          openai: {
            options: {
              apiKey: "test-openai-key",
            },
          },
        },
      },
      database: {
        anthropic: { name: "Anthropic" },
        openai: { name: "OpenAI" },
      },
      existing: new Set(["anthropic"]),
    })

    expect(result).toEqual([{ id: "openai", name: "OpenAI" }])
  })
})
