import { describe, expect, test } from "bun:test"
import { rateLimitSnapshot } from "../src/route/executor.js"

describe("rateLimitSnapshot", () => {
  test("parses OpenAI-style request and token windows", () => {
    const snapshot = rateLimitSnapshot({
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-remaining-requests": "37",
      "x-ratelimit-reset-requests": "6m0s",
      "x-ratelimit-limit-tokens": "200000",
      "x-ratelimit-remaining-tokens": "200000",
    })
    expect(snapshot?.limit).toEqual({ requests: "100", tokens: "200000" })
    expect(snapshot?.remaining).toEqual({ requests: "37", tokens: "200000" })
    expect(snapshot?.reset).toEqual({ requests: "6m0s" })
  })

  test("parses Anthropic-style windows", () => {
    const snapshot = rateLimitSnapshot({
      "anthropic-ratelimit-requests-limit": "50",
      "anthropic-ratelimit-requests-remaining": "49",
      "anthropic-ratelimit-tokens-limit": "100000",
      "anthropic-ratelimit-tokens-remaining": "90000",
    })
    expect(snapshot?.limit).toEqual({ requests: "50", tokens: "100000" })
    expect(snapshot?.remaining).toEqual({ requests: "49", tokens: "90000" })
  })

  test("ignores headers from other families", () => {
    expect(rateLimitSnapshot({ "x-foo-limit": "1", "content-type": "application/json" })).toBeUndefined()
  })

  test("ignores a bare retry-after with no quota windows", () => {
    expect(rateLimitSnapshot({ "retry-after": "2" })?.limit).toBeUndefined()
    expect(rateLimitSnapshot({ "retry-after": "2" })?.remaining).toBeUndefined()
    expect(rateLimitSnapshot({ "retry-after": "2" })?.reset).toBeUndefined()
  })
})
