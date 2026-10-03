import { describe, expect, test } from "bun:test"
import { ProviderError } from "../../src/provider/error"
import { shouldFallback, resolveFallback } from "../../src/provider/fallback"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"

function namedError(opts: {
  name?: string
  status?: number
  message?: string
  retryable?: boolean
}) {
  return {
    name: opts.name ?? "APIError",
    data: {
      message: opts.message ?? "error",
      statusCode: opts.status,
      isRetryable: opts.retryable ?? false,
    },
  }
}

describe("shouldFallback", () => {
  test("429 rate limit returns true", () => {
    expect(shouldFallback(namedError({ status: 429 }))).toBe(true)
  })

  test("500 server error returns true", () => {
    expect(shouldFallback(namedError({ status: 500 }))).toBe(true)
  })

  test("502 bad gateway returns true", () => {
    expect(shouldFallback(namedError({ status: 502 }))).toBe(true)
  })

  test("503 service unavailable returns true", () => {
    expect(shouldFallback(namedError({ status: 503 }))).toBe(true)
  })

  test("404 model not found returns true", () => {
    expect(shouldFallback(namedError({ status: 404 }))).toBe(true)
  })

  test("401 auth error returns false", () => {
    expect(shouldFallback(namedError({ status: 401 }))).toBe(false)
  })

  test("413 context overflow returns false", () => {
    expect(shouldFallback(namedError({ status: 413 }))).toBe(false)
  })

  test("ContextOverflowError returns false", () => {
    expect(shouldFallback(namedError({ name: "ContextOverflowError" }))).toBe(false)
  })

  test("ProviderAuthError returns false", () => {
    expect(shouldFallback(namedError({ name: "ProviderAuthError" }))).toBe(false)
  })

  test("400 validation error returns false", () => {
    expect(shouldFallback(namedError({ status: 400, message: "invalid prompt" }))).toBe(false)
  })

  test("network error with isRetryable=true and no status returns true", () => {
    expect(shouldFallback(namedError({ retryable: true }))).toBe(true)
  })

  test("HeaderTimeoutError returns true", () => {
    expect(shouldFallback(new ProviderError.HeaderTimeoutError(30000))).toBe(true)
  })

  test("ResponseStreamError returns true", () => {
    expect(shouldFallback(new ProviderError.ResponseStreamError("stream timed out"))).toBe(true)
  })
})

describe("resolveFallback", () => {
  const config = {
    provider: {
      anthropic: {
        models: {
          "claude-sonnet-4": {
            fallback: ["openai/gpt-5", "google/gemini-3-pro"],
          },
        },
      },
      openai: {
        models: {
          "gpt-5": {
            fallback: ["anthropic/claude-sonnet-4"],
          },
        },
      },
    },
  } as unknown as ConfigV1.Info

  test("resolves first fallback for anthropic/claude-sonnet-4", () => {
    const result = resolveFallback({ providerID: "anthropic", modelID: "claude-sonnet-4" }, config)
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("resolves first fallback for openai/gpt-5", () => {
    const result = resolveFallback({ providerID: "openai", modelID: "gpt-5" }, config)
    expect(result).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4" })
  })

  test("returns undefined for model with no fallback configured", () => {
    const result = resolveFallback({ providerID: "google", modelID: "gemini-3-pro" }, config)
    expect(result).toBeUndefined()
  })

  test("returns undefined for unknown provider", () => {
    const result = resolveFallback({ providerID: "unknown", modelID: "model" }, config)
    expect(result).toBeUndefined()
  })

  test("returns undefined when provider has no models", () => {
    const cfg = { provider: { anthropic: {} } } as unknown as ConfigV1.Info
    const result = resolveFallback({ providerID: "anthropic", modelID: "claude-sonnet-4" }, cfg)
    expect(result).toBeUndefined()
  })

  test("returns undefined when config has no provider", () => {
    const cfg = {} as unknown as ConfigV1.Info
    const result = resolveFallback({ providerID: "anthropic", modelID: "claude-sonnet-4" }, cfg)
    expect(result).toBeUndefined()
  })

  test("skips already-tried fallbacks", () => {
    const result = resolveFallback(
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      config,
      new Set(["openai/gpt-5"]),
    )
    expect(result).toEqual({ providerID: "google", modelID: "gemini-3-pro" })
  })

  test("returns undefined when all fallbacks already tried", () => {
    const result = resolveFallback(
      { providerID: "anthropic", modelID: "claude-sonnet-4" },
      config,
      new Set(["openai/gpt-5", "google/gemini-3-pro"]),
    )
    expect(result).toBeUndefined()
  })

  test("skips invalid fallback entries with empty providerID", () => {
    const cfg = {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4": {
              fallback: ["/gpt-5", "openai/gpt-5"],
            },
          },
        },
      },
    } as unknown as ConfigV1.Info
    const result = resolveFallback({ providerID: "anthropic", modelID: "claude-sonnet-4" }, cfg)
    expect(result).toEqual({ providerID: "openai", modelID: "gpt-5" })
  })

  test("skips invalid fallback entries with empty modelID", () => {
    const cfg = {
      provider: {
        anthropic: {
          models: {
            "claude-sonnet-4": {
              fallback: ["openai/", "google/gemini-3-pro"],
            },
          },
        },
      },
    } as unknown as ConfigV1.Info
    const result = resolveFallback({ providerID: "anthropic", modelID: "claude-sonnet-4" }, cfg)
    expect(result).toEqual({ providerID: "google", modelID: "gemini-3-pro" })
  })
})
