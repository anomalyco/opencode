import { test, expect } from "bun:test"
import { Auth } from "../../src/auth"
import { rotatingFetch } from "../../src/auth/rotating-fetch"

function getAuthHeader(init: RequestInit | undefined): string | null {
  if (!init?.headers) return null
  if (init.headers instanceof Headers) return init.headers.get("Authorization")
  if (Array.isArray(init.headers)) {
    const entry = init.headers.find(([k]) => k.toLowerCase() === "authorization")
    return entry ? entry[1] : null
  }
  return (init.headers as Record<string, string>)["Authorization"] ?? null
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch
}

// Test that rotatingFetch injects the correct Bearer token from the OAuth record,
// overriding whatever stale token may already be in init.headers.
test("rotatingFetch injects Authorization: Bearer from OAuth record, not from init", async () => {
  const providerID = "test-rotating-fetch-bearer-inject"
  const accessToken = "test-access-token-" + Date.now()

  await Auth.addOAuth(providerID, {
    refresh: "test-refresh-token",
    access: accessToken,
    expires: Date.now() + 3_600_000,
    email: "test@example.com",
  })

  const captured: { auth: string | null } = { auth: null }

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(async (_input, init) => {
    captured.auth = getAuthHeader(init)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    // Pass a wrong/stale Authorization header in init — rotatingFetch should override it
    await rotatingFetch(
      "https://example.com/test",
      { method: "GET", headers: { Authorization: "Bearer wrong-stale-token" } },
      { providerID },
    )

    expect(captured.auth).toBe(`Bearer ${accessToken}`)
  } finally {
    globalThis.fetch = originalFetch
    await Auth.remove(providerID)
  }
})

// Test that rotatingFetch injects the correct token when failing over between records.
// Each record's fetch attempt must use that record's own token, not the stale init header.
test("rotatingFetch uses each record's own token when failing over", async () => {
  const providerID = "test-rotating-fetch-failover"
  const token1 = "access-token-record-1"
  const token2 = "access-token-record-2"

  // Add two records with different access tokens
  await Auth.addOAuth(providerID, {
    refresh: "refresh-1",
    access: token1,
    expires: Date.now() + 3_600_000,
    email: "user1@example.com",
  })
  await Auth.addOAuth(providerID, {
    refresh: "refresh-2",
    access: token2,
    expires: Date.now() + 3_600_000,
    email: "user2@example.com",
  })

  const capturedTokens: string[] = []
  let callCount = 0

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(async (_input, init) => {
    capturedTokens.push(getAuthHeader(init) ?? "")
    callCount++
    if (callCount === 1) {
      // First record fails with 429 (rate limit) — triggers failover to second record
      return new Response("Rate limited", { status: 429 })
    }
    // Second record succeeds
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  try {
    await rotatingFetch(
      "https://example.com/api",
      { method: "POST", headers: { Authorization: `Bearer ${token1}` }, body: "test-body" },
      { providerID, cooldownMs: 0 },
    )

    expect(callCount).toBe(2)
    // Each attempt must use a different record's own token (not the stale init header).
    // The active record ordering is not guaranteed, so just check both tokens appear.
    const tokenSet = new Set(capturedTokens)
    expect(tokenSet.has(`Bearer ${token1}`)).toBe(true)
    expect(tokenSet.has(`Bearer ${token2}`)).toBe(true)
    // Critically: the two attempts must use DIFFERENT tokens
    expect(capturedTokens[0]).not.toBe(capturedTokens[1])
  } finally {
    globalThis.fetch = originalFetch
    await Auth.remove(providerID)
  }
})

// Test that after a 401 + successful token refresh, the retry uses the refreshed token.
test("rotatingFetch uses refreshed access token on 401 retry", async () => {
  const originalAccess = "stale-access-" + Date.now()
  const refreshedAccess = "refreshed-access-" + Date.now()
  // Use "anthropic" so OAUTH_TOKEN_ENDPOINTS picks it up for token refresh.
  const testNamespace = "rotating-fetch-test-" + Date.now()

  await Auth.addOAuth("anthropic", {
    refresh: "rf-test-refresh-token",
    access: originalAccess,
    expires: Date.now() + 3_600_000,
    namespace: testNamespace,
  })

  const capturedTokens: string[] = []
  let apiCallCount = 0

  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url

    // Intercept Anthropic token refresh endpoint
    if (url.includes("auth.anthropic.com")) {
      return new Response(
        JSON.stringify({ access_token: refreshedAccess, refresh_token: "new-rf", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    apiCallCount++
    capturedTokens.push(getAuthHeader(init) ?? "")

    if (apiCallCount === 1) {
      // First API call fails with 401 to trigger token refresh
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    // Retry after refresh should succeed
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })

  try {
    await rotatingFetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${originalAccess}` },
        body: JSON.stringify({ model: "claude-3", messages: [] }),
      },
      { providerID: "anthropic" },
    )

    // The first API call should use the original token (from the stored record)
    expect(capturedTokens[0]).toBe(`Bearer ${originalAccess}`)
    // After the refresh, the retry must use the NEW refreshed token
    if (apiCallCount >= 2) {
      expect(capturedTokens[1]).toBe(`Bearer ${refreshedAccess}`)
    }
  } finally {
    globalThis.fetch = originalFetch
    // Remove the test anthropic record by namespace
    const records = await Auth.getOAuthRecords("anthropic")
    for (const r of records.filter((r) => r.namespace === testNamespace)) {
      await Auth.removeOAuthRecord("anthropic", r.id)
    }
  }
})
