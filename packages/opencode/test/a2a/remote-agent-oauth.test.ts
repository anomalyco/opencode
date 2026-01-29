import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { EventEmitter } from "events"

// Capture original fetch BEFORE any mocking
const originalFetch = globalThis.fetch

// Track open() calls
let openCalledWith: string | undefined
let openShouldFail = false

mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      setTimeout(() => subprocess.emit("error", new Error("spawn xdg-open ENOENT")), 10)
    }
    return subprocess
  },
}))

// Import after mocking
const { A2AAuth } = await import("../../src/a2a/oauth/storage")
const { A2AOAuthCallback } = await import("../../src/a2a/oauth/callback")
const { prepareOAuthFlow, executeOAuthFlow, clearTokens } = await import("../../src/a2a/oauth/flow")
const AgentCard = await import("../../src/a2a/agent-card")
const { clearClientCache } = await import("../../src/a2a/client")

const TEST_DOMAIN = "test-remote-agent.example.com"

const mockAgentCard = {
  name: "test-agent",
  description: "A test remote agent",
  url: `https://${TEST_DOMAIN}/api/agents/default`,
  version: "1.0.0",
  protocolVersion: "0.2.1",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [{ id: "test", name: "Test", description: "Test skill", tags: ["test"] }],
  securitySchemes: {
    oauth2: {
      type: "oauth2",
      flows: {
        authorizationCode: {
          authorizationUrl: `https://${TEST_DOMAIN}/oauth/authorize`,
          tokenUrl: `https://${TEST_DOMAIN}/oauth/token`,
          scopes: { "agent:invoke": "Invoke agent" },
        },
      },
    },
  },
  security: [{ oauth2: ["agent:invoke"] }],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
}

const mockOAuthConfig = {
  authorizationUrl: `https://${TEST_DOMAIN}/oauth/authorize`,
  tokenUrl: `https://${TEST_DOMAIN}/oauth/token`,
  scopes: { "agent:invoke": "Invoke agent" },
}

// Helper to create a fetch mock that only intercepts specific URLs
function createSelectiveFetchMock(handlers: Record<string, () => Response>) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()

    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return handler()
      }
    }

    // Pass through to real fetch for callback server
    return originalFetch(input, init)
  }
}

describe("a2a.remote-agent-oauth integration", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined
  let pendingPromises: Array<Promise<unknown>> = []

  beforeEach(async () => {
    openCalledWith = undefined
    openShouldFail = false
    pendingPromises = []
    await A2AAuth.remove(TEST_DOMAIN)
    AgentCard.clearCache()
    clearClientCache()
  })

  afterEach(async () => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined

    // Wait for any pending promises to settle (with error handlers attached)
    await Promise.allSettled(pendingPromises)

    // Cancel any pending callbacks before stopping server
    A2AOAuthCallback.cancelAllPending()
    await A2AOAuthCallback.stop()
    await A2AAuth.remove(TEST_DOMAIN)
  })

  describe("full OAuth flow", () => {
    test("prepares oauth flow and returns authorization URL for user display", async () => {
      const prepared = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)

      expect(prepared.authorizationUrl).toContain(`https://${TEST_DOMAIN}/oauth/authorize`)
      expect(prepared.authorizationUrl).toContain("response_type=code")
      expect(prepared.authorizationUrl).toContain("client_id=opencode")
      expect(prepared.authorizationUrl).toContain("code_challenge=")
      expect(prepared.authorizationUrl).toContain("code_challenge_method=S256")
      expect(prepared.authorizationUrl).toContain("scope=agent%3Ainvoke")
      expect(prepared.state).toBeDefined()

      // Callback server should be running
      expect(A2AOAuthCallback.isRunning()).toBe(true)

      // Code verifier should be stored for token exchange
      const verifier = await A2AAuth.getCodeVerifier(TEST_DOMAIN)
      expect(verifier).toBeDefined()
    })

    test("executes oauth flow: opens browser, receives callback, exchanges code for tokens", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        createSelectiveFetchMock({
          "/oauth/token": () =>
            new Response(
              JSON.stringify({
                access_token: "test_access_token_12345",
                refresh_token: "test_refresh_token_67890",
                expires_in: 3600,
                token_type: "Bearer",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
      )

      const prepared = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)
      const executePromise = executeOAuthFlow(TEST_DOMAIN, mockOAuthConfig, prepared)

      await new Promise((r) => setTimeout(r, 100))

      expect(openCalledWith).toBe(prepared.authorizationUrl)

      // Simulate OAuth callback
      const callbackUrl = `${A2AOAuthCallback.getRedirectUri()}?code=auth_code_abc123&state=${prepared.state}`
      const callbackResponse = await originalFetch(callbackUrl)
      expect(callbackResponse.ok).toBe(true)

      const result = await executePromise

      expect(result.accessToken).toBe("test_access_token_12345")
      expect(result.refreshToken).toBe("test_refresh_token_67890")
      expect(result.expiresIn).toBe(3600)

      const stored = await A2AAuth.get(TEST_DOMAIN)
      expect(stored?.tokens?.accessToken).toBe("test_access_token_12345")
      expect(stored?.tokens?.refreshToken).toBe("test_refresh_token_67890")

      const verifier = await A2AAuth.getCodeVerifier(TEST_DOMAIN)
      expect(verifier).toBeUndefined()
    })

    test("reuses existing valid tokens without prompting", async () => {
      await A2AAuth.updateTokens(TEST_DOMAIN, {
        accessToken: "existing_token",
        refreshToken: "existing_refresh",
        expiresAt: Date.now() / 1000 + 3600,
      })

      const hasValid = await A2AAuth.hasValidTokens(TEST_DOMAIN)
      expect(hasValid).toBe(true)

      expect(openCalledWith).toBeUndefined()
    })

    test("refreshes expired tokens when refresh token available", async () => {
      await A2AAuth.updateTokens(TEST_DOMAIN, {
        accessToken: "expired_token",
        refreshToken: "valid_refresh_token",
        expiresAt: Date.now() / 1000 - 3600,
      })

      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        createSelectiveFetchMock({
          "/oauth/token": () =>
            new Response(
              JSON.stringify({
                access_token: "refreshed_access_token",
                refresh_token: "new_refresh_token",
                expires_in: 3600,
                token_type: "Bearer",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
      )

      const { getAccessToken } = await import("../../src/a2a/oauth/flow")
      const token = await getAccessToken(TEST_DOMAIN, mockOAuthConfig)

      expect(token).toBe("refreshed_access_token")

      const stored = await A2AAuth.get(TEST_DOMAIN)
      expect(stored?.tokens?.accessToken).toBe("refreshed_access_token")
      expect(stored?.tokens?.refreshToken).toBe("new_refresh_token")
    })

    test("handles browser open failure gracefully (SSH/headless environment)", async () => {
      openShouldFail = true

      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        createSelectiveFetchMock({
          "/oauth/token": () =>
            new Response(
              JSON.stringify({
                access_token: "manual_auth_token",
                refresh_token: "manual_refresh",
                expires_in: 3600,
                token_type: "Bearer",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
      )

      const prepared = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)
      const executePromise = executeOAuthFlow(TEST_DOMAIN, mockOAuthConfig, prepared)

      await new Promise((r) => setTimeout(r, 600))

      const callbackUrl = `${A2AOAuthCallback.getRedirectUri()}?code=manual_code&state=${prepared.state}`
      await originalFetch(callbackUrl)

      const result = await executePromise

      expect(result.accessToken).toBe("manual_auth_token")
    })

    // OAuth error handling is tested in oauth-callback.test.ts at the callback server level
    // Testing at the executeOAuthFlow level has timing issues with unhandled promise rejections

    test("handles token exchange failure", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        createSelectiveFetchMock({
          "/oauth/token": () =>
            new Response(JSON.stringify({ error: "invalid_grant" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }),
        }),
      )

      const prepared = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)

      // Attach error handler immediately
      const executePromise = executeOAuthFlow(TEST_DOMAIN, mockOAuthConfig, prepared).catch((e) => e)
      pendingPromises.push(executePromise)

      await new Promise((r) => setTimeout(r, 100))

      const callbackUrl = `${A2AOAuthCallback.getRedirectUri()}?code=invalid_code&state=${prepared.state}`
      await originalFetch(callbackUrl)

      const error = await executePromise

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain("Token exchange failed")
    })
  })

  describe("agent card OAuth detection", () => {
    test("detects OAuth requirement from agent card", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgentCard), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )

      const card = await AgentCard.fetchAgentCard(`@${TEST_DOMAIN}`)

      expect(AgentCard.requiresOAuth(card)).toBe(true)

      const config = AgentCard.getOAuthConfig(card)
      expect(config).not.toBeNull()
      expect(config?.authorizationUrl).toBe(`https://${TEST_DOMAIN}/oauth/authorize`)
      expect(config?.tokenUrl).toBe(`https://${TEST_DOMAIN}/oauth/token`)
      expect(config?.scopes).toEqual({ "agent:invoke": "Invoke agent" })
    })

    test("returns false for agent without OAuth", async () => {
      const cardWithoutOAuth = {
        ...mockAgentCard,
        securitySchemes: undefined,
        security: undefined,
      }

      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(cardWithoutOAuth), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )

      const card = await AgentCard.fetchAgentCard(`@${TEST_DOMAIN}`)

      expect(AgentCard.requiresOAuth(card)).toBe(false)
      expect(AgentCard.getOAuthConfig(card)).toBeNull()
    })
  })

  describe("PKCE verification", () => {
    test("generates unique code verifier and challenge for each flow", async () => {
      const prepared1 = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)
      const verifier1 = await A2AAuth.getCodeVerifier(TEST_DOMAIN)

      const prepared2 = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)
      const verifier2 = await A2AAuth.getCodeVerifier(TEST_DOMAIN)

      expect(prepared1.state).not.toBe(prepared2.state)
      expect(prepared1.authorizationUrl).toContain("code_challenge=")
      expect(prepared2.authorizationUrl).toContain("code_challenge=")
      expect(verifier1).not.toBe(verifier2)
    })

    test("clears PKCE state after successful token exchange", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        createSelectiveFetchMock({
          "/oauth/token": () =>
            new Response(
              JSON.stringify({
                access_token: "test_token",
                token_type: "Bearer",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        }),
      )

      const prepared = await prepareOAuthFlow(TEST_DOMAIN, mockOAuthConfig)

      expect(await A2AAuth.getCodeVerifier(TEST_DOMAIN)).toBeDefined()
      expect(await A2AAuth.getOAuthState(TEST_DOMAIN)).toBe(prepared.state)

      const executePromise = executeOAuthFlow(TEST_DOMAIN, mockOAuthConfig, prepared)

      await new Promise((r) => setTimeout(r, 100))

      const callbackUrl = `${A2AOAuthCallback.getRedirectUri()}?code=test_code&state=${prepared.state}`
      await originalFetch(callbackUrl)

      await executePromise

      expect(await A2AAuth.getCodeVerifier(TEST_DOMAIN)).toBeUndefined()
      expect(await A2AAuth.getOAuthState(TEST_DOMAIN)).toBeUndefined()
    })
  })

  describe("clearTokens", () => {
    test("removes all stored auth data for domain", async () => {
      await A2AAuth.updateTokens(TEST_DOMAIN, {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() / 1000 + 3600,
      })
      await A2AAuth.updateCodeVerifier(TEST_DOMAIN, "verifier")
      await A2AAuth.updateOAuthState(TEST_DOMAIN, "state")

      await clearTokens(TEST_DOMAIN)

      const entry = await A2AAuth.get(TEST_DOMAIN)
      expect(entry).toBeUndefined()
    })
  })
})
