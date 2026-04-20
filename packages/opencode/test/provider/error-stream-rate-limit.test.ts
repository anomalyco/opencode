import { describe, expect, test } from "bun:test"
import { parseStreamError } from "@/provider/error"

describe("parseStreamError", () => {
  test("detects nested quota error inside SSE error envelope", () => {
    const parsed = parseStreamError({
      type: "error",
      error: {
        message: "You exceeded your current quota for this period.",
        type: "rate_limit_error",
        code: "user_quota_exceeded",
      },
    })

    expect(parsed).toEqual({
      type: "api_error",
      message: "Rate limit exceeded. Please wait and try again.",
      isRetryable: false,
      responseBody: JSON.stringify({
        type: "error",
        error: {
          message: "You exceeded your current quota for this period.",
          type: "rate_limit_error",
          code: "user_quota_exceeded",
        },
      }),
    })
  })

  test("extracts wait time from message", () => {
    const parsed = parseStreamError({
      type: "error",
      error: {
        message:
          "Rate limit for gpt-5 in organization org_x on tokens per min (TPM): Limit 1, Used 1, Requested 1. Please try again in 915ms.",
        type: "rate_limit_error",
        code: "user_quota_exceeded",
      },
    })

    expect(parsed?.type).toBe("api_error")
    expect(parsed?.message).toBe("Rate limit exceeded. Please wait 1s and try again.")
    if (parsed?.type === "api_error") {
      expect(parsed.isRetryable).toBe(true)
    }
  })
})
