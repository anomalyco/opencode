import { describe, expect, test } from "bun:test"
import { getProviderQuotaSnapshots } from "../../src/provider/quota"

function createMockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(handler, { preconnect: fetch.preconnect.bind(fetch) })
}

describe("provider quota snapshots", () => {
  test("maps Codex quota into exact provider quota windows", async () => {
    const quota = await getProviderQuotaSnapshots({
      getAuth: async () => ({
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
        accountId: "acc-123",
      }),
      setAuth: async () => undefined,
      fetchImpl: createMockFetch(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        expect(url).toBe("https://chatgpt.com/backend-api/wham/usage")

        const headers = new Headers(init?.headers)
        expect(headers.get("authorization")).toBe("Bearer access-token")
        expect(headers.get("ChatGPT-Account-Id")).toBe("acc-123")

        return new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 3,
                reset_at: 1_700_000_000,
              },
              secondary_window: {
                used_percent: 10,
                reset_at: 1_700_086_400,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }),
    })

    expect(quota.providerQuota).toEqual([
      {
        provider: "codex",
        label: "codex",
        fetchedAt: expect.any(Number),
        status: "available",
        windows: [
          {
            label: "5h",
            remainingPercent: 97,
            resetAt: 1_700_000_000,
            confidence: "exact",
            source: "official_api",
          },
          {
            label: "wk",
            remainingPercent: 90,
            resetAt: 1_700_086_400,
            confidence: "exact",
            source: "official_api",
          },
        ],
      },
    ])
    expect(quota.fetchedAt).toEqual(expect.any(Number))
  })

  test("returns an empty provider quota list when Codex auth is missing", async () => {
    const quota = await getProviderQuotaSnapshots({
      getAuth: async () => undefined,
      setAuth: async () => undefined,
    })

    expect(quota.providerQuota).toEqual([])
    expect(quota.fetchedAt).toEqual(expect.any(Number))
  })
})
