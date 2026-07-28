import { describe, expect, test } from "bun:test"
import { isTrustedIpcUrl } from "./ipc-origin"

describe("isTrustedIpcUrl", () => {
  test("allows packaged renderer pages", () => {
    expect(isTrustedIpcUrl("oc://renderer/index.html", undefined)).toBe(true)
  })

  test("rejects other packaged and remote origins", () => {
    expect(isTrustedIpcUrl("oc://attacker/index.html", undefined)).toBe(false)
    expect(isTrustedIpcUrl("https://example.com", undefined)).toBe(false)
    expect(isTrustedIpcUrl("not a url", undefined)).toBe(false)
  })

  test("allows only the configured development origin", () => {
    const devUrl = "http://localhost:5173"
    expect(isTrustedIpcUrl("http://localhost:5173/index.html", devUrl)).toBe(true)
    expect(isTrustedIpcUrl("http://localhost:5174/index.html", devUrl)).toBe(false)
  })
})
