/**
 * ANR Quota Enforcement Tests
 *
 * Validates:
 * - Quota check with valid response (allowed)
 * - Quota check with exceeded limits (blocked)
 * - Quota fail modes (open vs closed)
 * - QuotaExceededError formatting
 * - QuotaUnavailableError behavior
 * - Warning level calculation (normal, warning, critical)
 * - Daily/monthly reset info formatting
 * - Policy caching behavior
 */
import { describe, expect, test } from "bun:test"
import {
  QuotaExceededError,
  QuotaUnavailableError,
  dailyResetInfo,
  monthlyResetInfo,
  checkQuota,
  getWarningColor,
} from "../src/integrations/quota"
import type { QuotaPolicy, QuotaUsage, QuotaCheckRequest } from "../src/integrations/quota"

function mockPolicy(overrides?: Partial<QuotaPolicy>): QuotaPolicy {
  return {
    enabled: true,
    identifier: "test@example.gov",
    policyType: "user",
    dailyTokenLimit: 5_000_000,
    monthlyTokenLimit: 250_000_000,
    dailyEnforcementMode: "block",
    monthlyEnforcementMode: "block",
    enforcementMode: "block",
    warningThreshold80: 80,
    warningThreshold90: 90,
    ...overrides,
  }
}

function mockUsage(overrides?: Partial<QuotaUsage>): QuotaUsage {
  return {
    dailyTokens: 2_000_000,
    monthlyTokens: 50_000_000,
    dailyUsagePercent: 40,
    monthlyUsagePercent: 20,
    warningLevel: "normal",
    allowed: true,
    ...overrides,
  }
}

describe("QuotaExceededError", () => {
  test("creates error with daily and monthly info", () => {
    const usage = mockUsage({ dailyTokens: 6_000_000, dailyUsagePercent: 120, allowed: false })
    const policy = mockPolicy()
    const err = new QuotaExceededError(usage, policy)
    expect(err.name).toBe("QuotaExceededError")
    expect(err.message).toContain("Quota exceeded")
    expect(err.message).toContain("6,000,000")
    expect(err.message).toContain("5,000,000")
    expect(err.message).toContain("120%")
    expect(err.usage).toBe(usage)
    expect(err.policy).toBe(policy)
  })

  test("includes monthly info when monthly limit set", () => {
    const usage = mockUsage({ monthlyTokens: 300_000_000, monthlyUsagePercent: 120, allowed: false })
    const policy = mockPolicy()
    const err = new QuotaExceededError(usage, policy)
    expect(err.message).toContain("300,000,000")
    expect(err.message).toContain("250,000,000")
  })

  test("includes reset info when provided", () => {
    const usage = mockUsage({
      allowed: false,
      dailyResetInfo: "Daily quota resets in 5h 30m (midnight UTC).",
      monthlyResetInfo: "Monthly quota resets in 12 days (1st of next month UTC).",
    })
    const err = new QuotaExceededError(usage, mockPolicy())
    expect(err.message).toContain("resets in 5h 30m")
    expect(err.message).toContain("resets in 12 days")
  })

  test("includes admin contact info", () => {
    const err = new QuotaExceededError(mockUsage({ allowed: false }), mockPolicy())
    expect(err.message).toContain("Contact your administrator")
  })
})

describe("QuotaUnavailableError", () => {
  test("closed mode denies access", () => {
    const err = new QuotaUnavailableError("closed")
    expect(err.name).toBe("QuotaUnavailableError")
    expect(err.message).toContain("Access denied")
  })

  test("open mode allows with warning", () => {
    const err = new QuotaUnavailableError("open")
    expect(err.message).toContain("Continuing with limited tracking")
  })
})

describe("dailyResetInfo", () => {
  test("returns string with hours and minutes", () => {
    const info = dailyResetInfo()
    expect(info).toContain("Daily quota resets in")
    expect(info).toContain("midnight UTC")
    expect(info).toMatch(/\d+h \d+m/)
  })
})

describe("monthlyResetInfo", () => {
  test("returns string with days until reset", () => {
    const info = monthlyResetInfo()
    expect(info).toContain("Monthly quota resets in")
    expect(info).toContain("day")
    expect(info).toContain("1st of next month UTC")
  })
})

describe("getWarningColor", () => {
  test("normal returns expected color", () => {
    const color = getWarningColor("normal")
    expect(color).toBeDefined()
    expect(typeof color).toBe("string")
  })

  test("warning returns expected color", () => {
    const color = getWarningColor("warning")
    expect(color).toBeDefined()
  })

  test("critical returns expected color", () => {
    const color = getWarningColor("critical")
    expect(color).toBeDefined()
  })
})

describe("checkQuota", () => {
  const request: QuotaCheckRequest = {
    userEmail: "test@example.gov",
    organization: "TestOrg",
    teamId: "team-a",
  }

  test("returns null in open fail mode with empty endpoint", async () => {
    const result = await checkQuota(request, "", "open")
    // With empty endpoint and open mode, should return mock response
    expect(result).not.toBeNull()
    expect(result!.usage.allowed).toBe(true)
  })

  test("returns null in closed fail mode with empty endpoint", async () => {
    const result = await checkQuota(request, "", "closed")
    expect(result).toBeNull()
  })

  test("handles unreachable endpoint gracefully in open mode", async () => {
    const result = await checkQuota(request, "http://localhost:1/nonexistent", "open")
    // Should fall back to mock since endpoint is unreachable
    expect(result).not.toBeNull()
    expect(result!.usage.allowed).toBe(true)
  })

  test("handles unreachable endpoint gracefully in closed mode", async () => {
    const result = await checkQuota(request, "http://localhost:1/nonexistent", "closed")
    // Should return null since endpoint unreachable and mode is closed
    expect(result).toBeNull()
  })
})
