import { describe, expect, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  type IdTokenClaims,
  CodexAuthPlugin,
} from "../../src/plugin/codex"
import type { PluginInput } from "@opencode-ai/plugin"
import { ModelID, ProviderID } from "@/provider/schema"

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

  describe("loader model filtering", () => {
    interface MockModel {
      id: ReturnType<typeof ModelID.make>
      providerID: typeof ProviderID.openai
      name: string
    }

    interface MockProvider {
      id: typeof ProviderID.openai
      models: Record<string, MockModel>
    }

    function createMockProvider(models: Record<string, MockModel>): MockProvider {
      return {
        id: ProviderID.openai,
        models: { ...models },
      }
    }

    function createMockModel(id: string): MockModel {
      return {
        id: ModelID.make(id),
        providerID: ProviderID.openai,
        name: id,
      }
    }

    async function runLoaderFilter(models: Record<string, MockModel>) {
      const mockInput = {
        client: { auth: { set: async () => {} } },
        directory: "/tmp/test",
        worktree: "/tmp/test",
        serverUrl: "http://localhost:3000",
      } as unknown as PluginInput
      const plugin = await CodexAuthPlugin(mockInput)
      const provider = createMockProvider(models)
      const oauthAuth = { type: "oauth" as const, refresh: "rt", access: "at", expires: Date.now() + 3600000 }
      const loader = plugin.auth!.loader!
      await loader(async () => oauthAuth, provider as unknown as Parameters<typeof loader>[1])
      return Object.keys(provider.models)
    }

    test("keeps gpt-5.4-mini in models", async () => {
      const models = {
        "gpt-5.4-mini": createMockModel("gpt-5.4-mini"),
        "gpt-4o": createMockModel("gpt-4o"),
      }
      const remaining = await runLoaderFilter(models)
      expect(remaining).toContain("gpt-5.4-mini")
    })

    test("filters out gpt-5.4-nano (API-only)", async () => {
      const models = {
        "gpt-5.4-nano": createMockModel("gpt-5.4-nano"),
        "gpt-4o": createMockModel("gpt-4o"),
      }
      const remaining = await runLoaderFilter(models)
      expect(remaining).not.toContain("gpt-5.4-nano")
    })

    test("filters out unrelated non-codex models", async () => {
      const models = {
        "gpt-5.4-mini": createMockModel("gpt-5.4-mini"),
        "gpt-5.4-nano": createMockModel("gpt-5.4-nano"),
        "gpt-4o": createMockModel("gpt-4o"),
        "gpt-4-turbo": createMockModel("gpt-4-turbo"),
        "o1-preview": createMockModel("o1-preview"),
        "claude-3": createMockModel("claude-3"),
      }
      const remaining = await runLoaderFilter(models)
      expect(remaining).toContain("gpt-5.4-mini")
      expect(remaining).not.toContain("gpt-5.4-nano")
      expect(remaining).not.toContain("gpt-4o")
      expect(remaining).not.toContain("gpt-4-turbo")
      expect(remaining).not.toContain("o1-preview")
      expect(remaining).not.toContain("claude-3")
    })

    test("keeps all codex-named models", async () => {
      const models = {
        "gpt-5.3-codex": createMockModel("gpt-5.3-codex"),
        "gpt-5.2-codex": createMockModel("gpt-5.2-codex"),
        "gpt-5.1-codex-mini": createMockModel("gpt-5.1-codex-mini"),
        "some-random-model": createMockModel("some-random-model"),
      }
      const remaining = await runLoaderFilter(models)
      expect(remaining).toContain("gpt-5.3-codex")
      expect(remaining).toContain("gpt-5.2-codex")
      expect(remaining).toContain("gpt-5.1-codex-mini")
      expect(remaining).not.toContain("some-random-model")
    })

    test("keeps explicitly allowed non-codex models", async () => {
      const models = {
        "gpt-5.4": createMockModel("gpt-5.4"),
        "gpt-5.2": createMockModel("gpt-5.2"),
        "gpt-5.1-codex-max": createMockModel("gpt-5.1-codex-max"),
        "random-model": createMockModel("random-model"),
      }
      const remaining = await runLoaderFilter(models)
      expect(remaining).toContain("gpt-5.4")
      expect(remaining).toContain("gpt-5.2")
      expect(remaining).toContain("gpt-5.1-codex-max")
      expect(remaining).not.toContain("random-model")
    })
  })
})
