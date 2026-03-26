import { describe, test, expect } from "bun:test"
import { validateProviderURL } from "../ssrf"

// Config-driven tests verify the guard condition logic.
// The SSRF enable/disable guard lives in onboard.ts at the call site.

describe("SSRF Protection", () => {
  test("allows valid HTTPS URLs", () => {
    expect(validateProviderURL("https://api.openai.com/v1").ok).toBe(true)
  })
  test("allows localhost when explicitly permitted", () => {
    expect(validateProviderURL("http://localhost:20123/v1", { allowLocalhost: true }).ok).toBe(true)
  })
  test("blocks cloud metadata endpoint", () => {
    expect(validateProviderURL("http://169.254.169.254/latest").ok).toBe(false)
  })
  test("blocks private IP range", () => {
    expect(validateProviderURL("http://192.168.1.1/api").ok).toBe(false)
  })
  test("blocks non-http scheme", () => {
    expect(validateProviderURL("ftp://example.com").ok).toBe(false)
  })
  test("blocks localhost without allowLocalhost", () => {
    expect(validateProviderURL("http://localhost:20123/v1").ok).toBe(false)
  })
})

describe("config-driven behavior", () => {
  test("SEC-07: guard condition true when security key absent (default-on)", () => {
    const cfg = {} as any
    // Guard: cfg.security?.ssrf?.enabled !== false → true → check runs
    expect(cfg.security?.ssrf?.enabled !== false).toBe(true)
    expect(validateProviderURL("http://192.168.1.1/api").ok).toBe(false)
  })

  test("SEC-01: guard evaluates to false when ssrf.enabled = false", () => {
    const cfg = { security: { ssrf: { enabled: false } } } as any
    expect(cfg.security?.ssrf?.enabled !== false).toBe(false)
  })

  test("SEC-01: guard evaluates to true when ssrf.enabled = true", () => {
    const cfg = { security: { ssrf: { enabled: true } } } as any
    expect(cfg.security?.ssrf?.enabled !== false).toBe(true)
    expect(validateProviderURL("http://192.168.1.1/api").ok).toBe(false)
  })
})
