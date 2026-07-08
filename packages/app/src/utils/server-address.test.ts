import { describe, expect, test } from "bun:test"
import { isExternalSchemeAddress, isSafeBrokerScheme } from "./server-address"

describe("isExternalSchemeAddress", () => {
  test("non-http(s) scheme URLs are external", () => {
    expect(isExternalSchemeAddress("my-helper://connect?target=pod")).toBe(true)
    expect(isExternalSchemeAddress("scheme://x")).toBe(true)
    expect(isExternalSchemeAddress("  My-Helper://x ")).toBe(true)
  })

  test("http and https addresses are not external", () => {
    expect(isExternalSchemeAddress("http://localhost:4096")).toBe(false)
    expect(isExternalSchemeAddress("https://example.com")).toBe(false)
    expect(isExternalSchemeAddress("  HTTP://x ")).toBe(false)
  })

  test("bare names and hosts are not external", () => {
    expect(isExternalSchemeAddress("my-remote")).toBe(false)
    expect(isExternalSchemeAddress("remote-host.internal:8080")).toBe(false)
  })

  test("blank input is not external", () => {
    expect(isExternalSchemeAddress("")).toBe(false)
    expect(isExternalSchemeAddress("   ")).toBe(false)
  })
})

describe("isSafeBrokerScheme", () => {
  test("accepts ordinary broker schemes", () => {
    expect(isSafeBrokerScheme("my-helper://connect?target=pod")).toBe(true)
    expect(isSafeBrokerScheme("  My-Helper://x ")).toBe(true)
  })

  test("rejects http(s) and dangerous schemes", () => {
    expect(isSafeBrokerScheme("http://localhost:4096")).toBe(false)
    expect(isSafeBrokerScheme("https://example.com")).toBe(false)
    expect(isSafeBrokerScheme("file:///etc/passwd")).toBe(false)
    expect(isSafeBrokerScheme("smb://server/share")).toBe(false)
    expect(isSafeBrokerScheme("javascript://alert(1)")).toBe(false)
    expect(isSafeBrokerScheme("")).toBe(false)
  })
})
