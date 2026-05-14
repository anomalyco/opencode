import { describe, expect, test } from "bun:test"
import {
  doRefresh,
  parseDeviceTokenResponse,
  TokenStore,
  type RefreshResult,
  type TokenSnapshot,
} from "../../src/plugin/minimax/minimax"

const REFRESH_RESULT = (overrides: Partial<RefreshResult> = {}): RefreshResult => ({
  access_token: "new_access",
  refresh_token: "new_refresh",
  expired_in: Date.now() + 3_600_000,
  resource_url: "https://api.minimax.io/anthropic/v1",
  ...overrides,
})

const SNAPSHOT = (overrides: Partial<TokenSnapshot> = {}): TokenSnapshot => ({
  access: "old_access",
  refresh: "old_refresh",
  expires: Date.now() + 60_000, // 1 min from now — within REFRESH_BUFFER_MS, will trigger refresh
  resourceUrl: "https://api.minimax.io/anthropic/v1",
  ...overrides,
})

describe("TokenStore.ensureFresh — bug #1: persistAuth ordering", () => {
  test("when persist throws, in-memory state must NOT be ahead of disk", async () => {
    let persistedSnapshot: TokenSnapshot | null = null
    const store = new TokenStore({
      refresh: async () => REFRESH_RESULT({ refresh_token: "rotated_refresh" }),
      persist: async () => {
        throw new Error("simulated disk write failure")
      },
    })
    store.set(SNAPSHOT())

    const ok = await store.ensureFresh()

    // Refresh should report failure since persist failed.
    expect(ok).toBe(false)
    // CRITICAL: in-memory refresh_token must still be the old one,
    // because the new one was never persisted. Otherwise on the next
    // attempt we'd POST the new (untrusted-by-server-yet) refresh_token
    // and lose the old one (which the server already invalidated).
    expect(store.get()?.refresh).toBe("old_refresh")
    expect(persistedSnapshot).toBeNull()
  })

  test("happy path: when persist succeeds, in-memory matches disk", async () => {
    let persistedSnapshot: TokenSnapshot | null = null
    const store = new TokenStore({
      refresh: async () => REFRESH_RESULT({ refresh_token: "rotated_refresh" }),
      persist: async (s) => {
        persistedSnapshot = { ...s }
      },
    })
    store.set(SNAPSHOT())

    const ok = await store.ensureFresh()

    expect(ok).toBe(true)
    expect(store.get()?.refresh).toBe("rotated_refresh")
    expect(persistedSnapshot).not.toBeNull()
    expect(persistedSnapshot!.refresh).toBe("rotated_refresh")
  })
})

describe("TokenStore.ensureFresh — bug #3: expired_in:0 short-circuit", () => {
  test("expires=0 must NOT be treated as 'infinite token, never refresh'", async () => {
    let refreshCalled = false
    const store = new TokenStore({
      refresh: async () => {
        refreshCalled = true
        return REFRESH_RESULT()
      },
      persist: async () => {},
    })
    // expires=0 is what we get when server omitted expired_in in a refresh response.
    // It should NOT mean "valid forever" — it should mean "we don't know, treat as expired".
    store.set(SNAPSHOT({ expires: 0 }))

    const ok = await store.ensureFresh()

    // With buggy code: returns true and never refreshes (treats 0 as "infinite").
    // After fix: should attempt refresh OR return false.
    expect(refreshCalled || ok === false).toBe(true)
  })
})

describe("doRefresh — bug #5: no retry on transient 5xx", () => {
  test("retries when first call returns 503, succeeds on second", async () => {
    let calls = 0
    const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls++
      if (calls === 1) {
        return new Response("temporarily unavailable", { status: 503 })
      }
      return new Response(
        JSON.stringify({
          status: "success",
          access_token: "after_retry",
          refresh_token: "rotated",
          expired_in: Date.now() + 3_600_000,
          resource_url: "https://api.minimax.io/anthropic/v1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch

    const result = await doRefresh({
      authBaseUrl: "https://account.minimax.io",
      clientId: "test-client",
      refreshToken: "rt",
      fetchImpl,
    })

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(result?.access_token).toBe("after_retry")
  })

  test("does NOT retry on 4xx (refresh_token genuinely invalid)", async () => {
    let calls = 0
    const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      calls++
      return new Response("invalid refresh token", { status: 400 })
    }) as typeof fetch

    const result = await doRefresh({
      authBaseUrl: "https://account.minimax.io",
      clientId: "test-client",
      refreshToken: "rt",
      fetchImpl,
    })

    expect(result).toBeNull()
    expect(calls).toBe(1) // 4xx = give up immediately
  })
})

describe("parseDeviceTokenResponse — bug #6: empty refresh_token fallback", () => {
  test("status=success but no refresh_token → must fail loud, not store empty", () => {
    // If we stored refresh="" we'd later POST refresh_token="" to the server
    // and get 400. User would be silently logged out. Must fail upfront.
    const result = parseDeviceTokenResponse({
      status: "success",
      access_token: "good_access",
      expired_in: Date.now() + 3_600_000,
      // refresh_token intentionally missing
    })

    expect(result.type).toBe("failed")
  })

  test("happy path: full success response parses correctly", () => {
    const result = parseDeviceTokenResponse({
      status: "success",
      access_token: "a",
      refresh_token: "r",
      expired_in: 12345,
      resource_url: "https://api.minimax.io/anthropic/v1",
    })

    expect(result.type).toBe("success")
    if (result.type !== "success") return
    expect(result.access).toBe("a")
    expect(result.refresh).toBe("r")
    expect(result.expires).toBe(12345)
    expect(result.enterpriseUrl).toBe("https://api.minimax.io/anthropic/v1")
  })

  test("status=pending → pending result", () => {
    const result = parseDeviceTokenResponse({ status: "pending" })
    expect(result.type).toBe("pending")
  })
})
