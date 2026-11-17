import { describe, expect, test } from "bun:test"
import { httpFailure } from "../src/route/executor"

describe("HTTP context status", () => {
  test("returns a provider error without http context for a nonstandard status", () => {
    const failure = httpFailure({
      message: "Provider request failed with HTTP 999: proxy said no",
      url: "http://example.test",
      status: 999,
      responseBody: '{"error":{"message":"proxy said no"}}',
    })
    const reason = failure.reason as { message: string; http?: { status: number } }

    expect(reason.http).toBeUndefined()
    expect(reason.message).toContain("999")
  })

  test("adds the raw status when the provider message does not include it", () => {
    const failure = httpFailure({ message: "proxy said no", url: "http://example.test", status: 999 })
    const reason = failure.reason as { message: string; http?: { status: number } }

    expect(reason.http).toBeUndefined()
    expect(reason.message).toBe("proxy said no (nonstandard HTTP 999)")
  })

  test("does not duplicate a status already present in the message", () => {
    const message = "Provider request failed with HTTP 999: proxy said no"
    const failure = httpFailure({ message, url: "http://example.test", status: 999 })
    const reason = failure.reason as { message: string }

    expect(reason.message).toBe(message)
  })

  test("keeps http context for a standard status", () => {
    const failure = httpFailure({ message: "rate limited", url: "http://example.test", status: 429 })
    const reason = failure.reason as { http?: { status: number } }

    expect(reason.http?.status).toBe(429)
  })
})
