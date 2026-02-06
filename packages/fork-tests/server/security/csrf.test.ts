import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { generateCSRFToken, validateCSRFToken, getCSRFSecret } from "../../../../opencode/src/server/security/csrf"

describe("CSRF utilities", () => {
  const testSecret = "test-secret-key-for-hmac-signing"
  const sessionId = "test-session-id"

  describe("generateCSRFToken", () => {
    it("returns token in correct format (signature.randomValue)", () => {
      const token = generateCSRFToken(sessionId, testSecret)

      // Should have exactly one dot
      expect(token.split(".").length).toBe(2)

      const [signature, randomValue] = token.split(".")

      // Signature should be 64 hex chars (SHA256 = 32 bytes = 64 hex)
      expect(signature).toMatch(/^[0-9a-f]{64}$/)

      // Random value should be 64 hex chars (32 bytes = 64 hex)
      expect(randomValue).toMatch(/^[0-9a-f]{64}$/)
    })

    it("generates different random values for each call", () => {
      const token1 = generateCSRFToken(sessionId, testSecret)
      const token2 = generateCSRFToken(sessionId, testSecret)

      expect(token1).not.toBe(token2)

      // Random parts should differ
      const [, random1] = token1.split(".")
      const [, random2] = token2.split(".")
      expect(random1).not.toBe(random2)
    })

    it("generates different signatures for different session IDs", () => {
      const token1 = generateCSRFToken("session-1", testSecret)
      const token2 = generateCSRFToken("session-2", testSecret)

      const [sig1] = token1.split(".")
      const [sig2] = token2.split(".")

      expect(sig1).not.toBe(sig2)
    })
  })

  describe("validateCSRFToken", () => {
    it("returns true for valid token", () => {
      const token = generateCSRFToken(sessionId, testSecret)
      const isValid = validateCSRFToken(token, sessionId, testSecret)

      expect(isValid).toBe(true)
    })

    it("returns false for tampered signature", () => {
      const token = generateCSRFToken(sessionId, testSecret)
      const [signature, randomValue] = token.split(".")

      // Flip one character in signature
      const tamperedSig = signature.substring(0, 10) + "x" + signature.substring(11)
      const tamperedToken = `${tamperedSig}.${randomValue}`

      const isValid = validateCSRFToken(tamperedToken, sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for tampered randomValue", () => {
      const token = generateCSRFToken(sessionId, testSecret)
      const [signature, randomValue] = token.split(".")

      // Flip one character in random value
      const tamperedRandom = randomValue.substring(0, 10) + "x" + randomValue.substring(11)
      const tamperedToken = `${signature}.${tamperedRandom}`

      const isValid = validateCSRFToken(tamperedToken, sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for different sessionId", () => {
      const token = generateCSRFToken("session-1", testSecret)
      const isValid = validateCSRFToken(token, "session-2", testSecret)

      expect(isValid).toBe(false)
    })

    it("returns false for malformed token (no dot)", () => {
      const isValid = validateCSRFToken("invalid-token-no-dot", sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for malformed token (multiple dots)", () => {
      const isValid = validateCSRFToken("part1.part2.part3", sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for empty string", () => {
      const isValid = validateCSRFToken("", sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for token with empty signature", () => {
      const isValid = validateCSRFToken(".randomvalue", sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("returns false for token with empty random value", () => {
      const isValid = validateCSRFToken("signature.", sessionId, testSecret)
      expect(isValid).toBe(false)
    })

    it("handles length mismatch gracefully (returns false, does not throw)", () => {
      // Short signature that won't match expected length
      const shortToken = "abc.def"

      expect(() => {
        const isValid = validateCSRFToken(shortToken, sessionId, testSecret)
        expect(isValid).toBe(false)
      }).not.toThrow()
    })
  })

  describe("getCSRFSecret", () => {
    let originalEnv: string | undefined

    beforeEach(() => {
      originalEnv = process.env.OPENCODE_CSRF_SECRET
    })

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.OPENCODE_CSRF_SECRET = originalEnv
      } else {
        delete process.env.OPENCODE_CSRF_SECRET
      }
    })

    it("returns consistent value across calls", () => {
      const secret1 = getCSRFSecret()
      const secret2 = getCSRFSecret()

      expect(secret1).toBe(secret2)
      expect(secret1).toBeTruthy()
    })

    it("uses OPENCODE_CSRF_SECRET env var when set", () => {
      const envSecret = "env-secret-key"
      process.env.OPENCODE_CSRF_SECRET = envSecret

      const secret = getCSRFSecret()
      expect(secret).toBe(envSecret)
    })
  })
})
