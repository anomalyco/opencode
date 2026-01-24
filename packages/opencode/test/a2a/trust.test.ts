import { describe, expect, test, beforeEach, mock, spyOn } from "bun:test"
import {
  isTrusted,
  trustForSession,
  revokeSessionTrust,
  clearSessionTrust,
  getSessionTrustedDomains,
} from "../../src/a2a/trust"
import { Config } from "../../src/config/config"

describe("a2a.trust", () => {
  beforeEach(() => {
    clearSessionTrust()
  })

  describe("session trust", () => {
    test("checks session trust - returns true for trusted domain", async () => {
      trustForSession("example.com")

      const result = await isTrusted("example.com")
      expect(result).toBe(true)
    })

    test("checks session trust - returns false for untrusted domain", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: { domains: [] },
      } as any)

      const result = await isTrusted("untrusted.com")
      expect(result).toBe(false)
    })

    test("adds session trust", () => {
      trustForSession("example.com")

      const domains = getSessionTrustedDomains()
      expect(domains).toContain("example.com")
    })

    test("revokes session trust", async () => {
      trustForSession("example.com")
      revokeSessionTrust("example.com")

      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: { domains: [] },
      } as any)

      const result = await isTrusted("example.com")
      expect(result).toBe(false)
    })

    test("clears all session trust", () => {
      trustForSession("example.com")
      trustForSession("other.com")

      clearSessionTrust()

      const domains = getSessionTrustedDomains()
      expect(domains).toHaveLength(0)
    })

    test("getSessionTrustedDomains returns all trusted domains", () => {
      trustForSession("example.com")
      trustForSession("other.com")
      trustForSession("third.com")

      const domains = getSessionTrustedDomains()
      expect(domains).toHaveLength(3)
      expect(domains).toContain("example.com")
      expect(domains).toContain("other.com")
      expect(domains).toContain("third.com")
    })

    test("does not duplicate domains", () => {
      trustForSession("example.com")
      trustForSession("example.com")

      const domains = getSessionTrustedDomains()
      expect(domains).toHaveLength(1)
    })
  })

  describe("config trust", () => {
    test("checks config trust - returns true for configured domain", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: { domains: ["trusted.com", "also-trusted.com"] },
      } as any)

      const result = await isTrusted("trusted.com")
      expect(result).toBe(true)
    })

    test("checks config trust - returns false when domain not in config", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: { domains: ["other.com"] },
      } as any)

      const result = await isTrusted("untrusted.com")
      expect(result).toBe(false)
    })

    test("session trust takes priority over config check", async () => {
      trustForSession("example.com")

      const result = await isTrusted("example.com")
      expect(result).toBe(true)
    })

    test("handles missing remoteAgents config", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const result = await isTrusted("example.com")
      expect(result).toBe(false)
    })

    test("handles missing domains array", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: {},
      } as any)

      const result = await isTrusted("example.com")
      expect(result).toBe(false)
    })
  })
})
