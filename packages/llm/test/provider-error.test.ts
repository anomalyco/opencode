import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src"
import { classifyProviderFailure } from "../src/provider-error"

describe("provider error classification", () => {
  test("classifies Z.AI GLM token limit messages as context overflow", () => {
    expect(isContextOverflow("tokens in request more than max tokens allowed")).toBe(true)
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
      ['{"code":"resource_exhausted"}', '{"code":"service_unavailable"}'].map(
        (message) => classifyProviderFailure({ message })._tag,
      ),
    ).toEqual(["ProviderInternal", "ProviderInternal"])
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

  test("keeps unknown and malformed provider payloads non-retryable", () => {
    expect(classifyProviderFailure({ message: '{"error":{"message":"no_kv_space"}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: '{"type":"error","error":{"code":123}}' })._tag).toBe("UnknownProvider")
    expect(classifyProviderFailure({ message: "not-json" })._tag).toBe("UnknownProvider")
  })
})
