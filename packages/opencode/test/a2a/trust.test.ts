import { describe, expect, test, beforeEach, mock, spyOn } from "bun:test"
import {
  isTrusted,
  checkTrust,
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

  describe("permission-based trust (checkTrust)", () => {
    test("returns 'allow' for session-trusted domain", async () => {
      trustForSession("example.com")

      const result = await checkTrust("example.com")
      expect(result).toBe("allow")
    })

    test("returns 'allow' when permission.remote_agent allows domain", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "trusted.com": "allow",
          },
        },
      } as any)

      const result = await checkTrust("trusted.com")
      expect(result).toBe("allow")
    })

    test("returns 'deny' when permission.remote_agent denies domain", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "blocked.com": "deny",
          },
        },
      } as any)

      const result = await checkTrust("blocked.com")
      expect(result).toBe("deny")
    })

    test("returns 'ask' when permission.remote_agent is set to ask", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "*": "ask",
          },
        },
      } as any)

      const result = await checkTrust("any-domain.com")
      expect(result).toBe("ask")
    })

    test("uses wildcard patterns (last rule wins)", async () => {
      // Note: rules are evaluated in order, last matching rule wins
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "*": "deny",
            "*.trusted.com": "allow",
          },
        },
      } as any)

      const trustedResult = await checkTrust("api.trusted.com")
      expect(trustedResult).toBe("allow")

      const untrustedResult = await checkTrust("untrusted.com")
      expect(untrustedResult).toBe("deny")
    })

    test("falls back to remoteAgents.domains for legacy config", async () => {
      spyOn(Config, "get").mockResolvedValue({
        remoteAgents: { domains: ["legacy.com"] },
      } as any)

      const result = await checkTrust("legacy.com")
      expect(result).toBe("allow")
    })

    test("returns 'ask' when no config matches", async () => {
      spyOn(Config, "get").mockResolvedValue({} as any)

      const result = await checkTrust("unknown.com")
      expect(result).toBe("ask")
    })

    test("permission config takes precedence over remoteAgents.domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: {
            "example.com": "deny",
          },
        },
        remoteAgents: { domains: ["example.com"] },
      } as any)

      const result = await checkTrust("example.com")
      expect(result).toBe("deny")
    })

    test("supports string action for all domains", async () => {
      spyOn(Config, "get").mockResolvedValue({
        permission: {
          remote_agent: "allow",
        },
      } as any)

      const result = await checkTrust("any-domain.com")
      expect(result).toBe("allow")
    })
  })
})
