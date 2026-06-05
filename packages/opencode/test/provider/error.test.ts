import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"

function expiredError(opts: { message?: string; responseBody?: string; statusCode?: number } = {}) {
  return new APICallError({
    message: opts.message ?? "Request failed",
    url: "https://bedrock.us-east-1.amazonaws.com/model/invoke",
    requestBodyValues: {},
    statusCode: opts.statusCode ?? 401,
    responseBody: opts.responseBody,
    isRetryable: false,
  })
}

describe("ProviderError.isExpiredCredentials", () => {
  test("matches STS security token message in error message", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "The security token included in the request is expired" }),
      ),
    ).toBe(true)
  })

  test("matches STS security token message case-insensitively", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "THE SECURITY TOKEN INCLUDED IN THE REQUEST IS EXPIRED" }),
      ),
    ).toBe(true)
  })

  test("does not match ExpiredTokenException in message only — must be in structured __type field", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "ExpiredTokenException: Token has expired" }),
      ),
    ).toBe(false)
  })

  test("matches ExpiredTokenException as structured __type field in responseBody (real SDK behavior)", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "Unauthorized",
          responseBody: JSON.stringify({ __type: "ExpiredTokenException", message: "Token has expired" }),
          statusCode: 401,
        }),
      ),
    ).toBe(true)
  })

  test("matches ExpiredTokenException as structured __type field on 403", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "Forbidden",
          responseBody: JSON.stringify({ __type: "ExpiredTokenException", message: "Token has expired" }),
          statusCode: 403,
        }),
      ),
    ).toBe(true)
  })

  test("does not match InvalidClientTokenId — structurally invalid credential, retry won't help", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "InvalidClientTokenId: The security token is invalid", statusCode: 403 }),
      ),
    ).toBe(false)
  })

  test("does not match InvalidClientTokenId in responseBody __type field", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "Forbidden",
          responseBody: JSON.stringify({ __type: "InvalidClientTokenId" }),
          statusCode: 403,
        }),
      ),
    ).toBe(false)
  })

  test("does not match raw ExpiredTokenException string anywhere in responseBody — injection protection", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "Unauthorized",
          responseBody: '{"error":"something about ExpiredTokenException in a message field"}',
        }),
      ),
    ).toBe(false)
  })

  test("does not throw on malformed JSON in responseBody", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "Unauthorized", responseBody: "not json {{{{" }),
      ),
    ).toBe(false)
  })

  test("does not match a generic 401 without STS signals", () => {
    expect(
      ProviderError.isExpiredCredentials(expiredError({ message: "Unauthorized", statusCode: 401 })),
    ).toBe(false)
  })

  test("does not match a rate-limit error", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "Too many requests", statusCode: 429 }),
      ),
    ).toBe(false)
  })

  test("does not match a context overflow error", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({ message: "prompt is too long", statusCode: 400 }),
      ),
    ).toBe(false)
  })

  test("returns false for non-APICallError values", () => {
    expect(ProviderError.isExpiredCredentials(new Error("The security token included in the request is expired"))).toBe(
      false,
    )
    expect(ProviderError.isExpiredCredentials(null)).toBe(false)
    expect(ProviderError.isExpiredCredentials("ExpiredTokenException")).toBe(false)
  })
})
