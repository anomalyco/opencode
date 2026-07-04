import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { LLM, SessionError } from "../src/index.js"

describe("SessionError", () => {
  test("exports one identified closed union", () => {
    expect(SessionError.Error.ast.annotations?.identifier).toBe("Session.StructuredError")
    expect(Object.keys(SessionError).filter((key) => key !== "SessionError")).toEqual(["Error"])
  })

  test("round trips every closed error type through JSON", () => {
    const values: SessionError.Error[] = [
      { type: "provider.rate-limit", message: "Slow down", retryAfterMs: 2_500 },
      { type: "provider.auth", message: "Authentication failed" },
      { type: "provider.quota", message: "Quota exhausted" },
      { type: "provider.content-filter", message: "Response blocked" },
      { type: "provider.transport", message: "Connection failed" },
      { type: "provider.internal", message: "Provider failed" },
      { type: "provider.invalid-output", message: "Malformed response" },
      { type: "provider.invalid-request", message: "Invalid request" },
      { type: "provider.no-route", message: "No route" },
      { type: "provider.unknown", message: "Unknown provider failure" },
      { type: "permission.rejected", message: "Permission rejected", permission: "read", resources: ["a"] },
      { type: "tool.unknown", message: "Unknown tool", name: "missing" },
      { type: "tool.stale", message: "Stale tool", name: "old" },
      { type: "tool.execution", message: "Tool failed" },
      { type: "tool.result-missing", message: "Missing result", callID: "call_1" },
      { type: "aborted", message: "Interrupted", reason: "user" },
      { type: "unknown", message: "Unexpected", agent: "build" },
    ]
    const codec = Schema.fromJsonString(SessionError.Error)

    for (const value of values) {
      const encoded = Schema.encodeSync(codec)(value)
      expect(Schema.decodeUnknownSync(codec)(encoded)).toEqual(value)
    }
  })

  test("rejects unknown types and missing messages", () => {
    expect(() =>
      Schema.decodeUnknownSync(SessionError.Error)({ type: "provider.timeout", message: "Timeout" }),
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(SessionError.Error)({ type: "provider.auth" })).toThrow()
  })
})

test("FinishReason is the closed browser-safe provider set", () => {
  const reasons = ["stop", "length", "tool-calls", "content-filter", "error", "unknown"] as const
  expect(reasons.map((reason) => Schema.decodeUnknownSync(LLM.FinishReason)(reason))).toEqual([...reasons])
  expect(() => Schema.decodeUnknownSync(LLM.FinishReason)("other")).toThrow()
})
