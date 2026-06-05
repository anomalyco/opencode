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

  test("matches ExpiredTokenException in response body", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "401",
          responseBody: JSON.stringify({ __type: "ExpiredTokenException", message: "Token has expired" }),
        }),
      ),
    ).toBe(true)
  })

  test("matches InvalidClientTokenId in response body", () => {
    expect(
      ProviderError.isExpiredCredentials(
        expiredError({
          message: "403",
          responseBody: JSON.stringify({ code: "InvalidClientTokenId", message: "The security token is invalid" }),
        }),
      ),
    ).toBe(true)
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
