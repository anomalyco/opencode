import { describe, expect, test } from "bun:test"
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "../../src/a2a/oauth/pkce"

describe("a2a.oauth.pkce", () => {
  describe("generateCodeVerifier", () => {
    test("generates string of correct length", () => {
      const verifier = generateCodeVerifier()
      // Base64url encoding of 32 bytes = ~43 characters
      expect(verifier.length).toBeGreaterThanOrEqual(43)
    })

    test("generates unique values", () => {
      const v1 = generateCodeVerifier()
      const v2 = generateCodeVerifier()
      expect(v1).not.toBe(v2)
    })

    test("generates URL-safe characters only", () => {
      const verifier = generateCodeVerifier()
      // Should only contain base64url safe characters
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })

  describe("generateCodeChallenge", () => {
    test("generates different challenge from verifier", () => {
      const verifier = generateCodeVerifier()
      const challenge = generateCodeChallenge(verifier)

      expect(challenge).not.toBe(verifier)
    })

    test("generates consistent challenge for same verifier", () => {
      const verifier = "test-verifier-123"
      const c1 = generateCodeChallenge(verifier)
      const c2 = generateCodeChallenge(verifier)

      expect(c1).toBe(c2)
    })

    test("generates URL-safe characters only", () => {
      const verifier = generateCodeVerifier()
      const challenge = generateCodeChallenge(verifier)

      // Should only contain base64url safe characters (no + / =)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    test("generates different challenges for different verifiers", () => {
      const c1 = generateCodeChallenge("verifier-1")
      const c2 = generateCodeChallenge("verifier-2")

      expect(c1).not.toBe(c2)
    })
  })

  describe("generateState", () => {
    test("generates string of correct length", () => {
      const state = generateState()
      // 16 bytes base64url encoded = ~22 characters
      expect(state.length).toBeGreaterThanOrEqual(21)
      expect(state.length).toBeLessThanOrEqual(24)
    })

    test("generates unique values", () => {
      const s1 = generateState()
      const s2 = generateState()
      expect(s1).not.toBe(s2)
    })

    test("generates URL-safe characters only", () => {
      const state = generateState()
      // Base64url safe characters
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    })
  })
})
