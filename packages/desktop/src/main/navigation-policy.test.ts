import { describe, expect, test } from "bun:test"
import { isTrustedNavigationUrl } from "./navigation-policy"

describe("isTrustedNavigationUrl", () => {
  test("allows packaged renderer pages", () => {
    expect(isTrustedNavigationUrl("oc://renderer/index.html", undefined)).toBe(true)
    expect(isTrustedNavigationUrl("oc://renderer/assets/index.js", undefined)).toBe(true)
  })

  test("rejects other hosts and protocols", () => {
    expect(isTrustedNavigationUrl("oc://attacker/index.html", undefined)).toBe(false)
    expect(isTrustedNavigationUrl("https://example.com", undefined)).toBe(false)
    expect(isTrustedNavigationUrl("not a url", undefined)).toBe(false)
  })

  test("allows only the configured development origin", () => {
    const devUrl = "http://localhost:5173"
    expect(isTrustedNavigationUrl("http://localhost:5173/index.html", devUrl)).toBe(true)
    expect(isTrustedNavigationUrl("http://localhost:5174/index.html", devUrl)).toBe(false)
    expect(isTrustedNavigationUrl("https://localhost:5173/index.html", devUrl)).toBe(false)
  })
})
