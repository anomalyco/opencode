import { describe, expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { createOAuthRotatingFetch } from "../../src/auth/rotating-fetch"
import { withOAuthRecord } from "../../src/auth/context"

describe("OAuth subscription failover", () => {
  const providerID = "oauth-rotation-test"

  test("rotates on 429 (Retry-After) and succeeds with next account", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      if (auth.refresh === "r1") {
        return new Response("rate limited", {
          status: 429,
          headers: {
            "Retry-After": "1",
          },
        })
      }

      return new Response("ok", { status: 200 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })

    expect(response.status).toBe(200)

    const order = await Auth.OAuthPool.orderedIDs(providerID)
    expect(order[0]).toBe(a2.recordID)
    expect(order[1]).toBe(a1.recordID)
  })

  test("updates the correct OAuth record by refresh token without record context", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    await Auth.set(providerID, {
      type: "oauth",
      refresh: "r1",
      access: "updated-a1",
      expires: Date.now() + 60_000,
    })

    const record1 = await withOAuthRecord(providerID, a1.recordID, async () => Auth.get(providerID))
    const record2 = await withOAuthRecord(providerID, a2.recordID, async () => Auth.get(providerID))

    expect(record1?.type).toBe("oauth")
    expect(record1 && record1.type === "oauth" ? record1.access : "").toBe("updated-a1")

    expect(record2?.type).toBe("oauth")
    expect(record2 && record2.type === "oauth" ? record2.access : "").toBe("a2")
  })

  test("retries once on 401/403 by forcing refresh, then succeeds", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "bad",
      expires: Date.now() + 60_000,
    })
    await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "ok",
      expires: Date.now() + 60_000,
    })

    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      // Simulate plugin refresh behavior: when access is cleared/expired,
      // it refreshes and persists via Auth.set().
      if (!auth.access) {
        await Auth.set(providerID, {
          type: "oauth",
          refresh: auth.refresh,
          access: `refreshed-${auth.refresh}`,
          expires: Date.now() + 60_000,
        })
        return new Response("ok", { status: 200 })
      }

      if (auth.access === "bad") {
        return new Response("unauthorized", { status: 401 })
      }

      return new Response("ok", { status: 200 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })
    expect(response.status).toBe(200)

    const record1 = await withOAuthRecord(providerID, a1.recordID, async () => Auth.get(providerID))
    expect(record1?.type).toBe("oauth")
    expect(record1 && record1.type === "oauth" ? record1.access : "").toBe("refreshed-r1")
  })

  test("fails over on 401/403 when refresh does not fix the credential", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "bad",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "ok",
      expires: Date.now() + 60_000,
    })

    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      if (auth.refresh === "r1") {
        return new Response("unauthorized", { status: 401 })
      }

      return new Response("ok", { status: 200 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })

    expect(response.status).toBe(200)

    const order = await Auth.OAuthPool.orderedIDs(providerID)
    expect(order[0]).toBe(a2.recordID)
    expect(order[1]).toBe(a1.recordID)
  })

  test("sticks to the active credential until rate limited", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const counts = new Map<string, number>()
    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      const refresh = auth.refresh
      counts.set(refresh, (counts.get(refresh) ?? 0) + 1)

      if (refresh === "r1" && (counts.get(refresh) ?? 0) >= 3) {
        return new Response("rate limited", { status: 429 })
      }

      return new Response("ok", { status: 200 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })

    const first = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })
    expect(first.status).toBe(200)

    const second = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })
    expect(second.status).toBe(200)

    const beforeRateLimit = await Auth.OAuthPool.orderedIDs(providerID)
    expect(beforeRateLimit[0]).toBe(a1.recordID)
    expect(beforeRateLimit[1]).toBe(a2.recordID)

    const third = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })
    expect(third.status).toBe(200)

    const afterRateLimit = await Auth.OAuthPool.orderedIDs(providerID)
    expect(afterRateLimit[0]).toBe(a2.recordID)
    expect(afterRateLimit[1]).toBe(a1.recordID)
  })

  test("does not retry non-replayable bodies but rotates for the next request", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const counts = new Map<string, number>()
    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      counts.set(auth.refresh, (counts.get(auth.refresh) ?? 0) + 1)
      return new Response("rate limited", { status: 429 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"))
        controller.close()
      },
    })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body })

    expect(response.status).toBe(429)
    expect(counts.get("r1") ?? 0).toBe(1)
    expect(counts.get("r2") ?? 0).toBe(0)

    const order = await Auth.OAuthPool.orderedIDs(providerID)
    expect(order[0]).toBe(a2.recordID)
    expect(order[1]).toBe(a1.recordID)
  })

  test("returns the last response when all credentials are exhausted", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })
      return new Response("rate limited", { status: 429 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })

    expect(response.status).toBe(429)

    const records = await Auth.OAuthPool.list(providerID)
    const recordByID = new Map(records.map((record) => [record.id, record]))
    expect(recordByID.get(a1.recordID)?.health.failureCount ?? 0).toBe(1)
    expect(recordByID.get(a2.recordID)?.health.failureCount ?? 0).toBe(1)
  })

  test("fails over when a request throws", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    const a2 = await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      if (auth.refresh === "r1") {
        throw new Error("network down")
      }

      return new Response("ok", { status: 200 })
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })

    expect(response.status).toBe(200)

    const records = await Auth.OAuthPool.list(providerID)
    const recordByID = new Map(records.map((record) => [record.id, record]))
    expect(recordByID.get(a1.recordID)?.health.failureCount ?? 0).toBe(1)
    expect(recordByID.get(a2.recordID)?.health.failureCount ?? 0).toBe(0)
  })

  test("respects Retry-After HTTP date headers", async () => {
    await Auth.remove(providerID)

    const a1 = await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const originalNow = Date.now
    const now = 1_700_000_000_000
    Date.now = () => now

    try {
      const retryAt = new Date(now + 5_000).toUTCString()
      const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const auth = await Auth.get(providerID)
        expect(auth?.type).toBe("oauth")
        if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

        if (auth.refresh === "r1") {
          return new Response("rate limited", {
            status: 429,
            headers: {
              "Retry-After": retryAt,
            },
          })
        }

        return new Response("ok", { status: 200 })
      }

      const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
      const response = await fetchWithFailover("https://example.com", { method: "POST", body: "{}" })

      expect(response.status).toBe(200)

      const records = await Auth.OAuthPool.list(providerID)
      const recordByID = new Map(records.map((record) => [record.id, record]))
      expect(recordByID.get(a1.recordID)?.health.cooldownUntil).toBe(now + 5_000)
    } finally {
      Date.now = originalNow
    }
  })

  test("falls back when Request.clone throws", async () => {
    await Auth.remove(providerID)

    await Auth.addOAuth(providerID, {
      refresh: "r1",
      access: "a1",
      expires: Date.now() + 60_000,
    })
    await Auth.addOAuth(providerID, {
      refresh: "r2",
      access: "a2",
      expires: Date.now() + 60_000,
    })

    const counts = new Map<string, number>()
    const baseFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const auth = await Auth.get(providerID)
      expect(auth?.type).toBe("oauth")
      if (!auth || auth.type !== "oauth") return new Response("no auth", { status: 500 })

      counts.set(auth.refresh, (counts.get(auth.refresh) ?? 0) + 1)

      if (auth.refresh === "r1") {
        return new Response("rate limited", { status: 429 })
      }

      return new Response("ok", { status: 200 })
    }

    const request = new Request("https://example.com", { method: "POST" })
    ;(request as { clone: () => Request }).clone = () => {
      throw new Error("clone failed")
    }

    const fetchWithFailover = createOAuthRotatingFetch(baseFetch, { providerID })
    const response = await fetchWithFailover(request)

    expect(response.status).toBe(429)
    expect(counts.get("r1") ?? 0).toBe(1)
    expect(counts.get("r2") ?? 0).toBe(0)
  })
})
