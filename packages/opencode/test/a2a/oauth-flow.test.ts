import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { EventEmitter } from "events"

// Track open() calls and control behavior
let openShouldFail = false
let openCalledWith: string | undefined

mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      setTimeout(() => {
        subprocess.emit("error", new Error("spawn xdg-open ENOENT"))
      }, 10)
    }
    return subprocess
  },
}))

// Import after mocking
const { prepareOAuthFlow } = await import("../../src/a2a/oauth/flow")
const { A2AAuth } = await import("../../src/a2a/oauth/storage")
const { A2AOAuthCallback } = await import("../../src/a2a/oauth/callback")

const mockOAuthConfig = {
  authorizationUrl: "https://auth.example.com/authorize",
  tokenUrl: "https://auth.example.com/token",
  scopes: { read: "Read access", write: "Write access" },
}

describe("a2a.oauth.flow", () => {
  beforeEach(async () => {
    openShouldFail = false
    openCalledWith = undefined
    await A2AAuth.remove("test-domain.com")
  })

  afterEach(async () => {
    await A2AOAuthCallback.stop()
    await A2AAuth.remove("test-domain.com")
  })

  describe("prepareOAuthFlow", () => {
    test("returns authorization URL with correct parameters", async () => {
      const result = await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      expect(result.authorizationUrl).toContain("https://auth.example.com/authorize")
      expect(result.authorizationUrl).toContain("response_type=code")
      expect(result.authorizationUrl).toContain("client_id=opencode")
      expect(result.authorizationUrl).toContain("code_challenge=")
      expect(result.authorizationUrl).toContain("code_challenge_method=S256")
      expect(result.authorizationUrl).toContain("scope=read+write")
      expect(result.state).toBeDefined()
      expect(result.state.length).toBeGreaterThan(0)
    })

    test("stores code verifier for later use", async () => {
      await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      const verifier = await A2AAuth.getCodeVerifier("test-domain.com")
      expect(verifier).toBeDefined()
      expect(verifier!.length).toBeGreaterThan(0)
    })

    test("stores oauth state for CSRF protection", async () => {
      const result = await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      const storedState = await A2AAuth.getOAuthState("test-domain.com")
      expect(storedState).toBe(result.state)
    })

    test("starts callback server", async () => {
      await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      expect(A2AOAuthCallback.isRunning()).toBe(true)
    })

    test("includes redirect_uri pointing to callback server", async () => {
      const result = await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      expect(result.authorizationUrl).toContain("redirect_uri=")
      expect(result.authorizationUrl).toContain("127.0.0.1")
    })

    test("generates unique state for each call", async () => {
      const result1 = await prepareOAuthFlow("test-domain.com", mockOAuthConfig)
      const result2 = await prepareOAuthFlow("test-domain.com", mockOAuthConfig)

      expect(result1.state).not.toBe(result2.state)
    })
  })
})
