import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  CodexAuthPlugin,
  type IdTokenClaims,
} from "../../src/plugin/codex"
import type { PluginInput } from "@opencode-ai/plugin"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
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

  describe("oauth fetch", () => {
    test("preserves caller signal through token refresh and Codex rewrite", async () => {
      const signal = new AbortController().signal
      const urls: string[] = []
      const signals: (AbortSignal | undefined)[] = []
      const original = globalThis.fetch

      const next = Object.assign(
        async (input: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
          urls.push(url)
          signals.push(init?.signal ?? undefined)
          if (url.includes("/oauth/token")) {
            return new Response(
              JSON.stringify({
                id_token: "",
                access_token: "access-new",
                refresh_token: "refresh-new",
                expires_in: 3600,
              }),
              { status: 200 },
            )
          }
          return new Response("{}", { status: 200 })
        },
        { preconnect: original.preconnect },
      ) satisfies typeof fetch
      globalThis.fetch = next

      try {
        const sets: unknown[] = []
        const hooks = await CodexAuthPlugin({
          client: {
            auth: {
              set: async (input: unknown) => {
                sets.push(input)
              },
            },
          },
        } as unknown as PluginInput)
        if (!hooks.auth?.loader) throw new Error("missing auth loader")
        const loaded = await hooks.auth.loader(
          async () => ({
            type: "oauth",
            refresh: "refresh-old",
            access: "",
            expires: 0,
            accountId: "account",
          }),
          {
            models: {
              "gpt-5.3-codex": {
                cost: { input: 1, output: 1, cache: { read: 1, write: 1 } },
              },
            },
          } as unknown as Parameters<typeof hooks.auth.loader>[1],
        )

        if (!loaded.fetch) throw new Error("missing fetch")
        await loaded.fetch("https://api.openai.com/v1/responses", { signal })

        expect(urls[0]).toBe("https://auth.openai.com/oauth/token")
        expect(urls[1]).toBe("https://chatgpt.com/backend-api/codex/responses")
        expect(signals).toEqual([signal, signal])
        expect(sets.length).toBe(1)
      } finally {
        globalThis.fetch = original
      }
    })
  })
})
