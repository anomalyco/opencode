import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src/index.js"
import { classifyProviderFailure } from "../src/provider-error.js"

describe("provider error classification", () => {
  test("classifies provider token limit messages as context overflow", () => {
    const messages = [
      "tokens in request more than max tokens allowed",
      "Requested token count exceeds the model's maximum context length of 131072 tokens.",
      "Input length (265330) exceeds model's maximum context length (262144).",
      "Input length 131393 exceeds the maximum allowed input length of 131040 tokens.",
      "The input (516368 tokens) is longer than the model's context length (262144 tokens).",
      "Prompt has 5,958,968 tokens, but the configured context size is 256,000 tokens",
      "Too many tokens",
      "Token limit exceeded",
    ]

    expect(messages.every(isContextOverflow)).toBe(true)
  })

  test("classifies Anthropic request_too_large as recoverable overflow", () => {
    expect(
      classifyProviderFailure({
        message: '{"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}',
        status: 400,
      }),
    ).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
    expect(isContextOverflow("413 status code (no body)")).toBe(true)
  })

  test("classifies generic request size failures separately from context overflow", () => {
    const failures = [
      classifyProviderFailure({ message: "request too large", status: 413 }),
      classifyProviderFailure({ message: "upstream request entity too large", status: 502 }),
    ]

    expect(failures).toEqual(
      failures.map((failure) =>
        expect.objectContaining({ _tag: "InvalidRequest", classification: "payload-too-large" }),
      ),
    )
  })

  test("does not classify rate limits as context overflow", () => {
    const messages = [
      "Throttling error: Too many tokens, please wait before trying again.",
      "Rate limit exceeded, please retry after 30 seconds.",
      "Too many requests. Please slow down.",
    ]

    expect(messages.some(isContextOverflow)).toBe(false)
  })

  test("classifies V1 plain-text rate limit fallbacks", () => {
    expect(
      [
        "Request rate increased too quickly",
        "Rate limit exceeded, please try again later",
        "Too many requests, please slow down",
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["RateLimit", "RateLimit", "RateLimit"])
  })

  test("classifies V1 JSON rate limit fallbacks", () => {
    expect(
      [
        '{"type":"error","error":{"type":"too_many_requests"}}',
        '{"type":"error","error":{"code":"rate_limit_exceeded"}}',
        '{"code":"bad_request","error":{"code":"rate_limit_exceeded"}}',
        '{"type":"error","error":{"code":"unknown","type":"too_many_requests"}}',
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["RateLimit", "RateLimit", "RateLimit", "RateLimit"])
  })

  test("classifies V1 overloaded provider codes", () => {
    expect(
      ['{"code":"resource_exhausted"}', '{"code":"service_unavailable"}', '{"code":"slow_down"}'].map(
        (message) => classifyProviderFailure({ message })._tag,
      ),
    ).toEqual(["ProviderInternal", "ProviderInternal", "ProviderInternal"])
  })

  test("classifies transient client statuses as provider internal", () => {
    expect([408, 409].map((status) => classifyProviderFailure({ message: `HTTP ${status}`, status })._tag)).toEqual([
      "ProviderInternal",
      "ProviderInternal",
    ])
  })

  test("classifies any remaining 4xx status as an invalid request", () => {
    expect(
      [400, 402, 404, 418, 422, 451].map(
        (status) => classifyProviderFailure({ message: `HTTP ${status}`, status })._tag,
      ),
    ).toEqual(Array(6).fill("InvalidRequest"))
  })

  test("classifies nested provider codes when a top-level code is also present", () => {
    expect(
      [
        '{"code":"bad_request","error":{"code":"usage_not_included"}}',
        '{"code":"bad_request","error":{"code":"server_error"}}',
        '{"code":"bad_request","error":{"type":"invalid_request_error"}}',
      ].map((message) => classifyProviderFailure({ message })._tag),
    ).toEqual(["QuotaExceeded", "ProviderInternal", "InvalidRequest"])
  })

  test("leaves unrecognized failures unclassified for the retry default", () => {
    expect(classifyProviderFailure({ message: '{"error":{"message":"no_kv_space"}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: '{"type":"error","error":{"code":123}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "not-json" })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "network error" })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "Provider returned error" })._tag).toBe("UnknownProvider")
  })
})

describe("provider error rawBody classification", () => {
  test("classifies provider envelopes without separate code inputs", () => {
    const cases = [
      ['{"type":"error","error":{"type":"overloaded_error","message":"Try again"}}', "ProviderInternal"],
      ['{"error":{"code":"insufficient_quota","message":"Request failed"}}', "QuotaExceeded"],
      [
        '{"type":"response.failed","response":{"error":{"code":"authentication_error","message":"Denied"}}}',
        "Authentication",
      ],
      ['{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Try again"}}', "ProviderInternal"],
      ['{"exception":{"type":"throttlingException","details":{"message":"Try again"}}}', "RateLimit"],
    ] as const
    for (const [rawBody, expected] of cases) {
      const reason = classifyProviderFailure({ message: "Request failed", rawBody })
      expect(reason._tag).toBe(expected)
      expect(reason.body).toBe(rawBody)
      expect(reason).not.toHaveProperty("code")
    }
  })

  test("classifies separately supplied SDK data without replacing the response body", () => {
    const data = { error: { code: "authentication_error" } }
    for (const value of [data, JSON.stringify(data)]) {
      const reason = classifyProviderFailure({
        message: "Request failed",
        status: 400,
        rawBody: '{"message":"Request failed"}',
        data: value,
      })
      expect(reason._tag).toBe("Authentication")
      expect(reason.body).toBe('{"message":"Request failed"}')
    }
  })

  test("classifies overflow signals buried in the raw payload when the summary is vague", () => {
    const reason = classifyProviderFailure({
      message: "Request failed",
      rawBody: '{"error":{"message":"This model\'s maximum context length is 40960 tokens"}}',
    })
    expect(reason._tag).toBe("InvalidRequest")
    expect(reason).toMatchObject({ classification: "context-overflow" })
  })

  test("extracts nested codes from the raw payload", () => {
    expect(
      classifyProviderFailure({ message: "Request failed", rawBody: '{"error":{"code":"insufficient_quota"}}' })._tag,
    ).toBe("QuotaExceeded")
  })
})
