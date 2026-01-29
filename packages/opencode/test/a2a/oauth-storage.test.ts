import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { A2AAuth } from "../../src/a2a/oauth/storage"

describe("a2a.oauth.storage", () => {
  const testDomain = "test-storage-domain.com"

  beforeEach(async () => {
    await A2AAuth.remove(testDomain)
  })

  afterEach(async () => {
    await A2AAuth.remove(testDomain)
  })

  describe("tokens", () => {
    test("stores and retrieves tokens", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() / 1000 + 3600,
      })

      const entry = await A2AAuth.get(testDomain)
      expect(entry?.tokens?.accessToken).toBe("access-123")
      expect(entry?.tokens?.refreshToken).toBe("refresh-456")
    })

    test("returns undefined for unknown domain", async () => {
      const entry = await A2AAuth.get("unknown-domain.com")
      expect(entry).toBeUndefined()
    })

    test("removes tokens", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
      })
      await A2AAuth.remove(testDomain)

      const entry = await A2AAuth.get(testDomain)
      expect(entry).toBeUndefined()
    })
  })

  describe("token expiry", () => {
    test("isTokenExpired returns null when no tokens", async () => {
      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBeNull()
    })

    test("isTokenExpired returns false when no expiresAt", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(false)
    })

    test("isTokenExpired returns false for future expiry", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 + 3600, // 1 hour from now
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(false)
    })

    test("isTokenExpired returns true for past expiry", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 - 3600, // 1 hour ago
      })

      const expired = await A2AAuth.isTokenExpired(testDomain)
      expect(expired).toBe(true)
    })
  })

  describe("hasValidTokens", () => {
    test("returns false when no tokens", async () => {
      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(false)
    })

    test("returns true when tokens exist and not expired", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 + 3600,
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(true)
    })

    test("returns true when expired but refresh token exists", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: Date.now() / 1000 - 3600, // expired
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(true)
    })

    test("returns false when expired and no refresh token", async () => {
      await A2AAuth.updateTokens(testDomain, {
        accessToken: "access-123",
        expiresAt: Date.now() / 1000 - 3600, // expired
      })

      const valid = await A2AAuth.hasValidTokens(testDomain)
      expect(valid).toBe(false)
    })
  })

  describe("code verifier", () => {
    test("stores and retrieves code verifier", async () => {
      await A2AAuth.updateCodeVerifier(testDomain, "verifier-123")

      const verifier = await A2AAuth.getCodeVerifier(testDomain)
      expect(verifier).toBe("verifier-123")
    })

    test("clears code verifier", async () => {
      await A2AAuth.updateCodeVerifier(testDomain, "verifier-123")
      await A2AAuth.clearCodeVerifier(testDomain)

      const verifier = await A2AAuth.getCodeVerifier(testDomain)
      expect(verifier).toBeUndefined()
    })
  })

  describe("oauth state", () => {
    test("stores and retrieves oauth state", async () => {
      await A2AAuth.updateOAuthState(testDomain, "state-123")

      const state = await A2AAuth.getOAuthState(testDomain)
      expect(state).toBe("state-123")
    })

    test("clears oauth state", async () => {
      await A2AAuth.updateOAuthState(testDomain, "state-123")
      await A2AAuth.clearOAuthState(testDomain)

      const state = await A2AAuth.getOAuthState(testDomain)
      expect(state).toBeUndefined()
    })
  })
})
