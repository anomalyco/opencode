import { describe, expect, test } from "bun:test"
import type { Context } from "hono"
import {
  isLocalhost,
  isSecureConnection,
  shouldBlockInsecureLogin,
  getConnectionSecurityInfo,
} from "../../../src/server/security/https-detection"

/**
 * Mock Hono Context for testing.
 */
function mockContext(url: string, headers: Record<string, string> = {}): Context {
  return {
    req: {
      url,
      header: (name: string) => headers[name],
    },
  } as unknown as Context
}

describe("isLocalhost", () => {
  test("returns true for localhost", () => {
    const c = mockContext("http://localhost/test", { Host: "localhost" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns true for localhost with port", () => {
    const c = mockContext("http://localhost:4096/test", { Host: "localhost:4096" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns true for 127.0.0.1", () => {
    const c = mockContext("http://127.0.0.1/test", { Host: "127.0.0.1" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns true for 127.0.0.1 with port", () => {
    const c = mockContext("http://127.0.0.1:4096/test", { Host: "127.0.0.1:4096" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns true for ::1", () => {
    const c = mockContext("http://[::1]/test", { Host: "::1" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns true for [::1] with brackets", () => {
    const c = mockContext("http://[::1]:4096/test", { Host: "[::1]:4096" })
    expect(isLocalhost(c)).toBe(true)
  })

  test("returns false for example.com", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    expect(isLocalhost(c)).toBe(false)
  })
})

describe("isSecureConnection", () => {
  test("returns true for https URL", () => {
    const c = mockContext("https://example.com/test", { Host: "example.com" })
    expect(isSecureConnection(c, false)).toBe(true)
  })

  test("returns false for http URL", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    expect(isSecureConnection(c, false)).toBe(false)
  })

  test("checks X-Forwarded-Proto when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "https",
    })
    expect(isSecureConnection(c, true)).toBe(true)
  })

  test("accepts mixed-case X-Forwarded-Proto when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "HTTPS",
    })
    expect(isSecureConnection(c, true)).toBe(true)
  })

  test("uses first X-Forwarded-Proto value when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "https, http",
    })
    expect(isSecureConnection(c, true)).toBe(true)
  })

  test("treats first X-Forwarded-Proto value as authoritative when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "http, https",
    })
    expect(isSecureConnection(c, true)).toBe(false)
  })

  test("accepts Forwarded header proto when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      Forwarded: "proto=https;host=example.com",
    })
    expect(isSecureConnection(c, true)).toBe(true)
  })

  test("ignores X-Forwarded-Proto when trustProxy is false", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "https",
    })
    expect(isSecureConnection(c, false)).toBe(false)
  })
})

describe("shouldBlockInsecureLogin", () => {
  test("returns false when requireHttps is off", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    expect(shouldBlockInsecureLogin(c, { requireHttps: "off" })).toBe(false)
  })

  test("returns false for localhost even with block mode", () => {
    const c = mockContext("http://localhost:4096/test", { Host: "localhost:4096" })
    expect(shouldBlockInsecureLogin(c, { requireHttps: "block" })).toBe(false)
  })

  test("returns false for https connection", () => {
    const c = mockContext("https://example.com/test", { Host: "example.com" })
    expect(shouldBlockInsecureLogin(c, { requireHttps: "block" })).toBe(false)
  })

  test("returns true for http non-localhost with block mode", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    expect(shouldBlockInsecureLogin(c, { requireHttps: "block" })).toBe(true)
  })

  test("returns false for http non-localhost with warn mode", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    expect(shouldBlockInsecureLogin(c, { requireHttps: "warn" })).toBe(false)
  })
})

describe("getConnectionSecurityInfo", () => {
  test("returns correct shouldWarn for warn mode on insecure connection", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    const info = getConnectionSecurityInfo(c, { requireHttps: "warn" })
    expect(info.shouldWarn).toBe(true)
    expect(info.shouldBlock).toBe(false)
    expect(info.isSecure).toBe(false)
    expect(info.isLocalhost).toBe(false)
  })

  test("returns correct shouldBlock for block mode on insecure connection", () => {
    const c = mockContext("http://example.com/test", { Host: "example.com" })
    const info = getConnectionSecurityInfo(c, { requireHttps: "block" })
    expect(info.shouldWarn).toBe(false)
    expect(info.shouldBlock).toBe(true)
    expect(info.isSecure).toBe(false)
    expect(info.isLocalhost).toBe(false)
  })

  test("returns safe values for localhost", () => {
    const c = mockContext("http://localhost:4096/test", { Host: "localhost:4096" })
    const info = getConnectionSecurityInfo(c, { requireHttps: "block" })
    expect(info.shouldWarn).toBe(false)
    expect(info.shouldBlock).toBe(false)
    expect(info.isSecure).toBe(false)
    expect(info.isLocalhost).toBe(true)
  })

  test("returns safe values for secure connection", () => {
    const c = mockContext("https://example.com/test", { Host: "example.com" })
    const info = getConnectionSecurityInfo(c, { requireHttps: "block" })
    expect(info.shouldWarn).toBe(false)
    expect(info.shouldBlock).toBe(false)
    expect(info.isSecure).toBe(true)
    expect(info.isLocalhost).toBe(false)
  })

  test("respects trustProxy setting", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      "X-Forwarded-Proto": "https",
    })
    const info = getConnectionSecurityInfo(c, { requireHttps: "warn", trustProxy: true })
    expect(info.isSecure).toBe(true)
    expect(info.shouldWarn).toBe(false)
    expect(info.shouldBlock).toBe(false)
  })

  test("respects Forwarded header when trustProxy is true", () => {
    const c = mockContext("http://example.com/test", {
      Host: "example.com",
      Forwarded: "proto=https;host=example.com",
    })
    const info = getConnectionSecurityInfo(c, { requireHttps: "warn", trustProxy: true })
    expect(info.isSecure).toBe(true)
    expect(info.shouldWarn).toBe(false)
    expect(info.shouldBlock).toBe(false)
  })
})
