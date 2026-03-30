import { describe, expect, test } from "bun:test"
import { APICallError, wrapLanguageModel } from "ai"
import { ProviderFallback } from "../../src/provider/fallback"
import type { LanguageModelV3 } from "@ai-sdk/provider"

function api(opts: { status?: number; body?: string; retryable?: boolean; message?: string }) {
  return new APICallError({
    message: opts.message ?? "",
    url: "https://example.com",
    requestBodyValues: {},
    statusCode: opts.status,
    responseHeaders: {},
    responseBody: opts.body,
    isRetryable: opts.retryable ?? false,
    data: undefined,
  })
}

describe("ProviderFallback.resolve", () => {
  const cfg = { "github-copilot": "amazon-bedrock" }

  test("maps copilot sonnet to bedrock", () => {
    const r = ProviderFallback.resolve("github-copilot", "claude-sonnet-4.6", cfg)
    expect(r).toEqual({ providerID: "amazon-bedrock", modelID: "us.anthropic.claude-sonnet-4-6" })
  })

  test("maps copilot opus to bedrock", () => {
    const r = ProviderFallback.resolve("github-copilot", "claude-opus-4.6", cfg)
    expect(r).toEqual({ providerID: "amazon-bedrock", modelID: "us.anthropic.claude-opus-4-6-v1" })
  })

  test("maps copilot haiku to bedrock", () => {
    const r = ProviderFallback.resolve("github-copilot", "claude-haiku-4.5", cfg)
    expect(r).toEqual({ providerID: "amazon-bedrock", modelID: "us.anthropic.claude-haiku-4-5-20251001-v1:0" })
  })

  test("returns undefined for unknown provider", () => {
    expect(ProviderFallback.resolve("openai", "gpt-4", cfg)).toBeUndefined()
  })

  test("returns undefined for unknown model", () => {
    expect(ProviderFallback.resolve("github-copilot", "gpt-4", cfg)).toBeUndefined()
  })

  test("returns undefined when no config", () => {
    expect(ProviderFallback.resolve("github-copilot", "claude-sonnet-4.6")).toBeUndefined()
  })

  test("returns undefined when provider not in config", () => {
    expect(ProviderFallback.resolve("github-copilot", "claude-sonnet-4.6", { openai: "anthropic" })).toBeUndefined()
  })
})

describe("ProviderFallback.shouldFallback", () => {
  // Auth errors — no fallback
  test("401 returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 401 }))).toBe(false)
  })

  test("403 returns true (copilot gateway transient)", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 403 }))).toBe(true)
  })

  // Context overflow — no fallback
  test("413 returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 413 }))).toBe(false)
  })

  test("overflow message returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 400, message: "prompt is too long" }))).toBe(false)
  })

  test("copilot overflow pattern returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 400, message: "exceeds the limit of 200000" }))).toBe(false)
  })

  test("bedrock overflow pattern returns false", () => {
    expect(
      ProviderFallback.shouldFallback(api({ status: 400, message: "input is too long for requested model" })),
    ).toBe(false)
  })

  test("context_length_exceeded returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 400, message: "context length exceeded" }))).toBe(false)
  })

  // Rate limits and gateway errors — fallback
  test("429 returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 429 }))).toBe(true)
  })

  test("500 returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 500 }))).toBe(true)
  })

  test("502 returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 502 }))).toBe(true)
  })

  test("503 returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 503 }))).toBe(true)
  })

  // Copilot bare-400
  test("bare-400 text body returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 400, body: "Bad Request\n" }))).toBe(true)
  })

  test("400 with JSON body returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ status: 400, body: '{"error":"validation"}' }))).toBe(false)
  })

  // SDK-wrapped network errors (APICallError with no statusCode)
  test("no statusCode + retryable returns true", () => {
    expect(ProviderFallback.shouldFallback(api({ retryable: true }))).toBe(true)
  })

  test("no statusCode + not retryable returns false", () => {
    expect(ProviderFallback.shouldFallback(api({ retryable: false }))).toBe(false)
  })

  // DOMException TimeoutError
  test("DOMException TimeoutError returns true", () => {
    expect(ProviderFallback.shouldFallback(new DOMException("timeout", "TimeoutError"))).toBe(true)
  })

  test("DOMException AbortError returns false", () => {
    expect(ProviderFallback.shouldFallback(new DOMException("aborted", "AbortError"))).toBe(false)
  })

  // Raw network errors
  test("TypeError returns true", () => {
    expect(ProviderFallback.shouldFallback(new TypeError("fetch failed"))).toBe(true)
  })

  test("ECONNREFUSED returns true", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    expect(ProviderFallback.shouldFallback(err)).toBe(true)
  })

  test("ECONNRESET returns true", () => {
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })
    expect(ProviderFallback.shouldFallback(err)).toBe(true)
  })

  // Unknown errors — no fallback
  test("plain Error returns false", () => {
    expect(ProviderFallback.shouldFallback(new Error("something"))).toBe(false)
  })

  test("string returns false", () => {
    expect(ProviderFallback.shouldFallback("error")).toBe(false)
  })

  test("null returns false", () => {
    expect(ProviderFallback.shouldFallback(null)).toBe(false)
  })
})

// Minimal mock model for middleware tests
function mock(opts?: { fail?: Error }): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: undefined as any,
    doGenerate: async () => {
      if (opts?.fail) throw opts.fail
      return { text: "generated" } as any
    },
    doStream: async () => {
      if (opts?.fail) throw opts.fail
      return { stream: "streamed" } as any
    },
  } as LanguageModelV3
}

describe("ProviderFallback.middleware", () => {
  test("calls primary on success (generate)", async () => {
    const primary = mock()
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    const result = await wrapped.doGenerate({} as any)
    expect((result as any).text).toBe("generated")
  })

  test("calls primary on success (stream)", async () => {
    const primary = mock()
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    const result = await wrapped.doStream({} as any)
    expect((result as any).stream).toBe("streamed")
  })

  test("falls back on retryable error (generate)", async () => {
    const primary = mock({ fail: api({ status: 429 }) })
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    const result = await wrapped.doGenerate({} as any)
    expect((result as any).text).toBe("generated")
  })

  test("falls back on retryable error (stream)", async () => {
    const primary = mock({ fail: api({ status: 503 }) })
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    const result = await wrapped.doStream({} as any)
    expect((result as any).stream).toBe("streamed")
  })

  test("rethrows non-fallback error (generate)", async () => {
    const primary = mock({ fail: api({ status: 401 }) })
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    await expect(wrapped.doGenerate({} as any)).rejects.toThrow()
  })

  test("rethrows non-fallback error (stream)", async () => {
    const primary = mock({ fail: api({ status: 413 }) })
    const fallback = mock()
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    await expect(wrapped.doStream({} as any)).rejects.toThrow()
  })

  test("propagates fallback error when both fail", async () => {
    const primary = mock({ fail: api({ status: 429 }) })
    const fallback = mock({ fail: api({ status: 500 }) })
    const wrapped = wrapLanguageModel({
      model: primary,
      middleware: [ProviderFallback.middleware(fallback)],
    })
    await expect(wrapped.doGenerate({} as any)).rejects.toThrow()
  })
})
