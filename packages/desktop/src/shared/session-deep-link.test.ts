import { describe, expect, test } from "bun:test"
import { sessionDeepLink } from "./session-deep-link"

describe("session deep links", () => {
  test("reads a session id", () => {
    expect(sessionDeepLink("opencode://session/ses_01ABCDEF")).toBe("ses_01ABCDEF")
    expect(sessionDeepLink(`opencode://session/${"a".repeat(256)}`)).toBe("a".repeat(256))
    expect(sessionDeepLink("opencode://session/has-dash_1")).toBe("has-dash_1")
  })

  test("rejects malformed links", () => {
    expect(sessionDeepLink("opencode://session/has%20space")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses%3F1")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%E2%80%8Bdef")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/../evil")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/%2e%2e")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/foo/bar")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses_01?x=1")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses_01#frag")).toBeUndefined()
    expect(sessionDeepLink("opencode://user:pass@session/ses_01")).toBeUndefined()
    expect(sessionDeepLink("opencode://session:1/ses_01")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/")).toBeUndefined()
    expect(sessionDeepLink(`opencode://session/${"a".repeat(257)}`)).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%2fdef")).toBeUndefined()
    expect(sessionDeepLink("opencode://console/authorized?window=window-a")).toBeUndefined()
    expect(sessionDeepLink("https://session/ses_01")).toBeUndefined()
    expect(sessionDeepLink("not a url")).toBeUndefined()
  })
})
