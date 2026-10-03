import { describe, expect, test } from "bun:test"
import { isWellKnownLoginUrl } from "../../src/cli/cmd/providers"

describe("isWellKnownLoginUrl", () => {
  test("rejects bare provider ids", () => {
    expect(isWellKnownLoginUrl("opencode")).toBe(false)
    expect(isWellKnownLoginUrl("openai")).toBe(false)
    expect(isWellKnownLoginUrl("anthropic")).toBe(false)
  })

  test("rejects undefined and empty values", () => {
    expect(isWellKnownLoginUrl(undefined)).toBe(false)
    expect(isWellKnownLoginUrl("")).toBe(false)
    expect(isWellKnownLoginUrl("   ")).toBe(false)
  })

  test("rejects bare domains without scheme", () => {
    // Without a scheme, fetch("example.com/.well-known/opencode") throws
    // `fetch() URL is invalid`. These must not enter the well-known flow.
    expect(isWellKnownLoginUrl("example.com")).toBe(false)
    expect(isWellKnownLoginUrl("opencode/.well-known/opencode")).toBe(false)
  })

  test("accepts https URLs", () => {
    expect(isWellKnownLoginUrl("https://example.com")).toBe(true)
    expect(isWellKnownLoginUrl("https://example.com/")).toBe(true)
    expect(isWellKnownLoginUrl("https://auth.corp.example.com/sso")).toBe(true)
  })

  test("accepts http URLs", () => {
    expect(isWellKnownLoginUrl("http://localhost:3000")).toBe(true)
    expect(isWellKnownLoginUrl("http://example.com")).toBe(true)
  })

  test("rejects non-http schemes", () => {
    expect(isWellKnownLoginUrl("ftp://example.com")).toBe(false)
    expect(isWellKnownLoginUrl("file:///etc/passwd")).toBe(false)
  })

  test("regression #50593: 'opencode' is a provider, not a fetch URL", () => {
    // Before the fix, `auth login opencode` entered the well-known branch and
    // ran `fetch("opencode/.well-known/opencode")`, which throws
    // `fetch() URL is invalid`. It must route to provider login instead.
    const positional = "opencode"
    expect(isWellKnownLoginUrl(positional)).toBe(false)
    expect(() => new URL(`${positional}/.well-known/opencode`)).toThrow()
  })
})
