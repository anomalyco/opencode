import { describe, test, expect } from "bun:test"
import { ProviderError } from "../../src/provider/error"
import { APICallError } from "ai"

function makeAPICallError(opts: {
  message?: string
  statusCode?: number
  responseBody?: string
}): APICallError {
  return new APICallError({
    message: opts.message ?? "",
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
    isRetryable: false,
    url: "",
    requestBodyValues: {},
  })
}

describe("ProviderError.parseAPICallError: error message extraction", () => {
  test("extracts nested error.message from OpenAI-shaped JSON body", () => {
    // OpenAI returns 4xx errors with {error: {message, type, code}}.
    // Previously the parser short-circuited on body.error (the object) and
    // failed the typeof string guard, so the raw structured body was dumped
    // to the user as e.g. `Bad Request: {"error":{"message":"...", ...}}`.
    const result = ProviderError.parseAPICallError({
      providerID: "openai" as any,
      error: makeAPICallError({
        message: "Bad Request",
        statusCode: 400,
        responseBody: JSON.stringify({
          error: {
            message: "The model `gpt-5-codex` does not exist or you do not have access to it.",
            type: "invalid_request_error",
            code: "model_not_found",
          },
        }),
      }),
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Bad Request")
      expect(result.message).toContain("gpt-5-codex")
      expect(result.message).toContain("does not exist")
      // Raw structured body must not be dumped when a clean message extracted.
      expect(result.message).not.toContain('"error":')
      expect(result.message).not.toContain("{")
    }
  })

  test("non-string body.error.message does not block a valid body.message", () => {
    // Defensive guard: a truthy non-string at any level (e.g. body.error.message
    // is an array) must not short-circuit a valid string further down the chain.
    const result = ProviderError.parseAPICallError({
      providerID: "openai" as any,
      error: makeAPICallError({
        message: "Bad Request",
        statusCode: 400,
        responseBody: JSON.stringify({
          error: { message: ["array", "of", "strings"] },
          message: "Real human-readable error",
        }),
      }),
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Real human-readable error")
      expect(result.message).not.toContain("array")
    }
  })

  test("falls back through the chain when body.error has no message but body.message does", () => {
    const result = ProviderError.parseAPICallError({
      providerID: "openai" as any,
      error: makeAPICallError({
        message: "Bad Request",
        statusCode: 400,
        responseBody: JSON.stringify({
          error: { code: "rate_limited", type: "throttle" },
          message: "Slow down",
        }),
      }),
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Slow down")
    }
  })

  test("extracts plain string body.error", () => {
    // Some providers return {error: "string"} rather than {error: {message: ...}}.
    const result = ProviderError.parseAPICallError({
      providerID: "anthropic" as any,
      error: makeAPICallError({
        message: "Bad Request",
        statusCode: 400,
        responseBody: JSON.stringify({ error: "Something went wrong" }),
      }),
    })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Something went wrong")
    }
  })
})
