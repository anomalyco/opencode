import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  getCodexQuotaSnapshot,
  resolveCodexOauthSession,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

function createMockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(handler, { preconnect: fetch.preconnect.bind(fetch) })
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  describe("resolveCodexOauthSession", () => {
    test("refreshes expired oauth tokens and persists the updated account id", async () => {
      const persisted: Array<unknown> = []
      const refreshedAccessToken = createTestJwt({ chatgpt_account_id: "acc-refreshed" })

      const session = await resolveCodexOauthSession({
        getAuth: async () => ({
          type: "oauth",
          refresh: "refresh-token",
          access: "expired-access",
          expires: Date.now() - 1_000,
          accountId: "acc-stale",
        }),
        setAuth: async (auth) => {
          persisted.push(auth)
        },
        fetchImpl: createMockFetch(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
          expect(url).toBe("https://auth.openai.com/oauth/token")
          return new Response(
            JSON.stringify({
              id_token: "",
              access_token: refreshedAccessToken,
              refresh_token: "refresh-token-next",
              expires_in: 7200,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }),
      })

      expect(session).toEqual({
        accessToken: refreshedAccessToken,
        accountId: "acc-refreshed",
      })
      expect(persisted).toHaveLength(1)
      expect(persisted[0]).toMatchObject({
        type: "oauth",
        refresh: "refresh-token-next",
        access: refreshedAccessToken,
        accountId: "acc-refreshed",
      })
    })

    test("keeps the existing refresh token when refresh response omits one", async () => {
      const persisted: Array<unknown> = []
      const refreshedAccessToken = createTestJwt({ chatgpt_account_id: "acc-refreshed" })

      await resolveCodexOauthSession({
        getAuth: async () => ({
          type: "oauth",
          refresh: "refresh-token-existing",
          access: "expired-access",
          expires: Date.now() - 1_000,
          accountId: "acc-stale",
        }),
        setAuth: async (auth) => {
          persisted.push(auth)
        },
        fetchImpl: createMockFetch(
          async () =>
            new Response(
              JSON.stringify({
                access_token: refreshedAccessToken,
                expires_in: 7200,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      })

      expect(persisted[0]).toMatchObject({
        type: "oauth",
        refresh: "refresh-token-existing",
        access: refreshedAccessToken,
        accountId: "acc-refreshed",
      })
    })
  })

  describe("getCodexQuotaSnapshot", () => {
    test("maps primary and secondary quota windows to remaining percentages", async () => {
      const quota = await getCodexQuotaSnapshot({
        getAuth: async () => ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60_000,
          accountId: "acc-123",
        }),
        setAuth: async () => undefined,
        fetchImpl: createMockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
          expect(url).toBe("https://chatgpt.com/backend-api/wham/usage")

          const headers = new Headers(init?.headers)
          expect(headers.get("authorization")).toBe("Bearer access-token")
          expect(headers.get("ChatGPT-Account-Id")).toBe("acc-123")

          return new Response(
            JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 39,
                  reset_after_seconds: 600,
                  reset_at: 1_700_000_000,
                },
                secondary_window: {
                  used_percent: 85,
                  reset_after_seconds: 86_400,
                  reset_at: 1_700_086_400,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }),
      })

      expect(quota).toEqual({
        fiveHour: {
          remainingPercent: 61,
          resetSeconds: 600,
          resetAt: 1_700_000_000,
        },
        weekly: {
          remainingPercent: 15,
          resetSeconds: 86_400,
          resetAt: 1_700_086_400,
        },
      })
    })

    test("returns undefined when openai oauth is not configured", async () => {
      const quota = await getCodexQuotaSnapshot({
        getAuth: async () => undefined,
        setAuth: async () => undefined,
      })

      expect(quota).toBeUndefined()
    })

    test("ignores nullable reset fields without dropping quota windows", async () => {
      const quota = await getCodexQuotaSnapshot({
        getAuth: async () => ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60_000,
        }),
        setAuth: async () => undefined,
        fetchImpl: createMockFetch(
          async () =>
            new Response(
              JSON.stringify({
                rate_limit: {
                  primary_window: {
                    used_percent: 12.5,
                    reset_after_seconds: null,
                    reset_at: null,
                  },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      })

      expect(quota).toEqual({
        fiveHour: {
          remainingPercent: 87.5,
        },
      })
    })
  })
})
