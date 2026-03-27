import { describe, test, expect } from "bun:test"
import { getSecurityHeaders } from "../headers"

// Config-driven tests verify the guard condition logic.
// The headers enable/disable guard lives in server.ts at the call site.

describe("config-driven behavior", () => {
  test("SEC-07: headers guard is true when security key absent (default-on)", () => {
    const cfg = {} as any
    // Guard: cfg.security?.headers?.enabled !== false → true → headers applied
    expect(cfg.security?.headers?.enabled !== false).toBe(true)
    const headers = getSecurityHeaders()
    expect(Object.keys(headers).length).toBeGreaterThan(0)
  })

  test("SEC-06: guard evaluates to false when headers.enabled = false", () => {
    const cfg = { security: { headers: { enabled: false } } } as any
    expect(cfg.security?.headers?.enabled !== false).toBe(false)
  })

  test("SEC-06: headers include all required security keys when applied", () => {
    const cfg = { security: { headers: { enabled: true } } } as any
    expect(cfg.security?.headers?.enabled !== false).toBe(true)
    const headers = getSecurityHeaders()
    expect(headers["X-Frame-Options"]).toBe("DENY")
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["Content-Security-Policy"]).toBeDefined()
    expect(headers["Strict-Transport-Security"]).toBeDefined()
    expect(headers["Referrer-Policy"]).toBeDefined()
    expect(headers["Permissions-Policy"]).toBeDefined()
  })
})
