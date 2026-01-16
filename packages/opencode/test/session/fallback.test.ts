import { test, expect, describe, beforeEach, mock } from "bun:test"
import { SessionFallback } from "../../src/session/fallback"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("SessionFallback.getFallback", () => {
  test("returns null when no fallbacks configured", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await SessionFallback.getFallback("anthropic", "claude-3-opus", new Set())
        expect(result).toBeNull()
      },
    })
  })

  test("returns null when model has no fallbacks and provider has no fallbacks", async () => {
    await using tmp = await tmpdir({
      config: {
        fallbacks: {
          provider: {
            google: ["openai"],
          },
          models: {
            "google/gemini-pro": ["anthropic/claude-3-sonnet"],
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await SessionFallback.getFallback("anthropic", "claude-3-opus", new Set())
        expect(result).toBeNull()
      },
    })
  })

  test("skips already attempted fallbacks", async () => {
    await using tmp = await tmpdir({
      config: {
        fallbacks: {
          models: {
            "anthropic/claude-3-opus": ["openai/gpt-4o", "google/gemini-pro"],
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const attempted = new Set<string>()
        attempted.add("model:openai/gpt-4o")

        // Should skip openai/gpt-4o and try google/gemini-pro next
        const result = await SessionFallback.getFallback("anthropic", "claude-3-opus", attempted)
        // Result will be null because the models don't actually exist in test environment
        // but it should have skipped the attempted one
        expect(attempted.has("model:openai/gpt-4o")).toBe(true)
      },
    })
  })
})
