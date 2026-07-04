import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LLM, SessionError } from "../src/index.js"

describe("SessionError", () => {
  test("exports one identified open envelope", () => {
    expect(SessionError.Error.ast.annotations?.identifier).toBe("Session.StructuredError")
    expect(Object.keys(SessionError).filter((key) => key !== "SessionError")).toEqual(["Error"])
  })

  test("round trips current and future error types through JSON", () => {
    const values: SessionError.Error[] = [
      { type: "provider.rate-limit", message: "Slow down" },
      { type: "provider.auth", message: "Authentication failed" },
      { type: "provider.future-condition", message: "A future provider failure" },
      { type: "unknown", message: "Unexpected" },
    ]
    const codec = Schema.fromJsonString(SessionError.Error)

    for (const value of values) {
      const encoded = Schema.encodeSync(codec)(value)
      expect(Schema.decodeUnknownSync(codec)(encoded)).toEqual(value)
    }
  })

  test("accepts future fields while exposing only the stable envelope", () => {
    expect(
      Schema.decodeUnknownSync(SessionError.Error)({
        type: "provider.timeout",
        message: "Timeout",
        retryAfterMs: 2_500,
      }),
    ).toEqual({ type: "provider.timeout", message: "Timeout" })
  })

  test("rejects missing envelope fields", () => {
    expect(() => Schema.decodeUnknownSync(SessionError.Error)({ type: "provider.auth" })).toThrow()
    expect(() => Schema.decodeUnknownSync(SessionError.Error)({ message: "Missing type" })).toThrow()
  })
})

test("FinishReason is the closed browser-safe provider set", () => {
  const reasons = ["stop", "length", "tool-calls", "content-filter", "error", "unknown"] as const
  expect(reasons.map((reason) => Schema.decodeUnknownSync(LLM.FinishReason)(reason))).toEqual([...reasons])
  expect(() => Schema.decodeUnknownSync(LLM.FinishReason)("other")).toThrow()
})
