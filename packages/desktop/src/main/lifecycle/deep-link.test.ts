import { describe, expect, test } from "bun:test"
import { consoleReturnWindow, sessionDeepLink } from "./deep-link"

describe("Console return deep links", () => {
  test("reads the originating Desktop window", () => {
    expect(consoleReturnWindow("opencode://console/authorized?window=window-a")).toBe("window-a")
    expect(consoleReturnWindow("opencode://console/authorized?window=window%20b")).toBe("window b")
  })

  test("rejects unrelated and malformed links", () => {
    expect(consoleReturnWindow("opencode://console/other?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("opencode://other/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("https://console/authorized?window=window-a")).toBeUndefined()
    expect(consoleReturnWindow("not a url")).toBeUndefined()
    expect(consoleReturnWindow("opencode://console/authorized")).toBeUndefined()
    expect(consoleReturnWindow("opencode://session/ses_01ABCDEF")).toBeUndefined()
  })
})

describe("session deep links", () => {
  test("reads a session id", () => {
    expect(sessionDeepLink("opencode://session/ses_01ABCDEF")).toBe("ses_01ABCDEF")
    expect(sessionDeepLink(`opencode://session/${"a".repeat(256)}`)).toBe("a".repeat(256))
    expect(sessionDeepLink("opencode://session/has%20space")).toBe("has space")
  })

  test("rejects malformed links", () => {
    expect(sessionDeepLink("opencode://session/../evil")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/%2e%2e/evil")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/%2e%2e")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/./ses_01")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/foo/bar")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses_01/")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses_01?x=1")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/ses_01#frag")).toBeUndefined()
    expect(sessionDeepLink("opencode://user:pass@session/ses_01")).toBeUndefined()
    expect(sessionDeepLink("opencode://session:1/ses_01")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/")).toBeUndefined()
    expect(sessionDeepLink("opencode://session")).toBeUndefined()
    expect(sessionDeepLink(`opencode://session/${"a".repeat(257)}`)).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%00def")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%01def")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%2fdef")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc%5cdef")).toBeUndefined()
    expect(sessionDeepLink("opencode://bogus/session/x")).toBeUndefined()
    expect(sessionDeepLink("opencode://console/authorized?window=window-a")).toBeUndefined()
    expect(sessionDeepLink("https://session/ses_01")).toBeUndefined()
    expect(sessionDeepLink("not a url")).toBeUndefined()
    expect(sessionDeepLink("opencode://session/abc\u0001def")).toBeUndefined()
  })
})
