import { describe, test, expect } from "bun:test"
import { customModelKeysFromConfig } from "./model-keys"

describe("customModelKeysFromConfig", () => {
  test("extracts keys from a typical config", () => {
    const config = {
      provider: {
        openrouter: {
          models: {
            "z-ai/glm-5.3": { limit: { context: 1048576, output: 132000 } },
            "other/model": {},
          },
        },
      },
    }
    const keys = customModelKeysFromConfig(config)
    expect(keys.has("openrouter:z-ai/glm-5.3")).toBe(true)
    expect(keys.has("openrouter:other/model")).toBe(true)
    expect(keys.has("openrouter:missing")).toBe(false)
    expect(keys.has("other:z-ai/glm-5.3")).toBe(false)
  })

  test("returns empty set for empty config", () => {
    expect(customModelKeysFromConfig({}).size).toBe(0)
  })

  test("returns empty set when config is null or undefined", () => {
    expect(customModelKeysFromConfig(null).size).toBe(0)
    expect(customModelKeysFromConfig(undefined).size).toBe(0)
  })

  test("returns empty set when provider is undefined", () => {
    expect(customModelKeysFromConfig({ provider: undefined }).size).toBe(0)
  })

  test("ignores providers without a models block", () => {
    const config = {
      provider: {
        openrouter: { options: {} },
        anthropic: { models: { "claude-sonnet-4": {} } },
      },
    }
    const keys = customModelKeysFromConfig(config)
    expect(keys.has("openrouter:anything")).toBe(false)
    expect(keys.has("anthropic:claude-sonnet-4")).toBe(true)
  })

  test("ignores models blocks that are not objects", () => {
    const config = {
      provider: {
        weird: { models: true },
      },
    }
    expect(customModelKeysFromConfig(config).size).toBe(0)
  })

  test("handles multiple providers with models", () => {
    const config = {
      provider: {
        openrouter: { models: { "a/b": {} } },
        custom: { models: { "x/y": {}, "z/w": {} } },
      },
    }
    const keys = customModelKeysFromConfig(config)
    expect(keys.size).toBe(3)
    expect(keys.has("openrouter:a/b")).toBe(true)
    expect(keys.has("custom:x/y")).toBe(true)
    expect(keys.has("custom:z/w")).toBe(true)
  })
})
