import { describe, expect, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  renderOAuthError,
  type IdTokenClaims,
} from "../../src/plugin/openai/codex"
import { isRecord } from "../../src/util/record"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  test("escapes provider errors in callback HTML", () => {
    const error = `</div><script>alert("xss" & 'more')</script>`
    const html = renderOAuthError(error)

    expect(html).toContain("&lt;/div&gt;&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;more&#39;)&lt;/script&gt;")
    expect(html).not.toContain(error)
  })

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

  test("installs websocket transport only when experimental websockets are enabled", async () => {
    const disabled = await CodexAuthPlugin({} as never)
    const enabled = await CodexAuthPlugin({} as never, { experimentalWebSockets: true })

    const disabledOptions = await disabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )
    const enabledOptions = await enabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )

    expect(disabledOptions.fetch).toBeUndefined()
    expect(enabledOptions.fetch).toBeFunction()
    await enabled.dispose?.()
  })

  test("uses Codex context limits for OAuth GPT models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const limit = { context: 1_050_000, input: 922_000, output: 128_000 }
    const provider = {
      models: Object.fromEntries(
        ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].map((id) => [
          id,
          { id, api: { id }, limit, cost: {} },
        ]),
      ),
    }

    const models = await hooks.provider!.models!(provider as never, { auth: { type: "oauth" } } as never)

    expect(models["gpt-5.4"]?.limit).toEqual(limit)
    expect(models["gpt-5.5"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-sol"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-terra"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-luna"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(await hooks.provider!.models!(provider as never, { auth: { type: "api" } } as never)).toBe(
      provider.models as never,
    )
  })

  test("rewrites GPT-5.6 OAuth requests for Responses Lite", async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = []
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          headers: new Headers(request.headers),
          body: await readRequestBody(request),
        })
        return Response.json({})
      },
    })
    const providerFetch = await loadCodexFetch(new URL("/backend-api/codex/responses", server.url).toString())
    const body = JSON.stringify({
      model: "gpt-5.6-luna",
      input: [
        {
          role: "user",
          content: [{ type: "input_image", image_url: "data:image/png;base64,test", detail: "high" }],
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: [{ type: "input_image", image_url: "data:image/png;base64,result", detail: "low" }],
        },
      ],
      instructions: "Be concise.",
      tools: [
        {
          type: "function",
          name: "noop",
          description: "No operation",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          strict: false,
        },
      ],
      parallel_tool_calls: true,
      prompt_cache_key: "ses_luna",
      reasoning: { effort: "high", summary: "auto" },
      stream: true,
    })
    const init = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "session-id": "ses_luna",
        "x-session-affinity": "ses_luna",
      },
      body,
    }

    await providerFetch("https://api.openai.com/v1/responses", init)
    await Promise.all(
      ["gpt-5.6-sol", "gpt-5.6-terra"].map((model) =>
        providerFetch("https://api.openai.com/v1/responses", {
          ...init,
          headers: {
            ...init.headers,
            "session-id": `ses_${model}`,
            "x-session-affinity": `ses_${model}`,
          },
          body: JSON.stringify({ model, input: [], stream: true }),
        }),
      ),
    )
    await providerFetch("https://api.openai.com/v1/responses", {
      ...init,
      body: JSON.stringify({ model: "gpt-5.6-luna", input: [], stream: true }),
    })

    expect(requests).toHaveLength(4)
    expect(
      requests
        .slice(0, 3)
        .map((request) => request.body.model)
        .sort(),
    ).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"])
    expect(requests.slice(0, 3).map((request) => request.headers.get("version"))).toEqual([
      "0.144.0",
      "0.144.0",
      "0.144.0",
    ])
    expect(
      requests.slice(0, 3).map((request) => request.headers.get("x-openai-internal-codex-responses-lite")),
    ).toEqual(["true", "true", "true"])
    const sessionID = requests[0]?.headers.get("session-id")
    expect(sessionID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(requests[3]?.headers.get("session-id")).toBe(sessionID)
    expect(requests[0]?.headers.get("x-session-affinity")).toBe(sessionID)
    expect(requests[0]?.body.prompt_cache_key).toBe(sessionID)
    expect(requests[0]?.body.tool_choice).toBe("auto")
    expect(requests[0]?.body.parallel_tool_calls).toBe(false)
    expect(requests[0]?.body.reasoning).toEqual({ effort: "high", summary: "auto", context: "all_turns" })
    expect(requests[0]?.body.tools).toBeUndefined()
    expect(requests[0]?.body.instructions).toBeUndefined()
    expect(requests[0]?.body.input).toEqual([
      {
        type: "additional_tools",
        role: "developer",
        tools: [
          {
            type: "function",
            name: "noop",
            description: "No operation",
            parameters: { type: "object", properties: {}, additionalProperties: false },
            strict: false,
          },
        ],
      },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "Be concise." }],
      },
      {
        role: "user",
        content: [{ type: "input_image", image_url: "data:image/png;base64,test" }],
      },
      {
        type: "function_call_output",
        call_id: "call_123",
        output: [{ type: "input_image", image_url: "data:image/png;base64,result" }],
      },
    ])
    expect(requests.slice(1).map((request) => request.body.input)).toEqual([
      [{ type: "additional_tools", role: "developer", tools: [] }],
      [{ type: "additional_tools", role: "developer", tools: [] }],
      [{ type: "additional_tools", role: "developer", tools: [] }],
    ])
  })

  test("leaves non-Lite OAuth requests unchanged", async () => {
    const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = []
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          headers: new Headers(request.headers),
          body: await readRequestBody(request),
        })
        return Response.json({})
      },
    })
    const providerFetch = await loadCodexFetch(new URL("/backend-api/codex/responses", server.url).toString())
    const body = {
      model: "gpt-5.5",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
      instructions: "Be concise.",
      tools: [],
      parallel_tool_calls: true,
      prompt_cache_key: "ses_legacy",
      reasoning: { effort: "medium", summary: "auto" },
      stream: true,
    }

    await providerFetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", "session-id": "ses_legacy" },
      body: JSON.stringify(body),
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.get("session-id")).toBe("ses_legacy")
    expect(requests[0]?.headers.get("version")).toBeNull()
    expect(requests[0]?.headers.get("x-openai-internal-codex-responses-lite")).toBeNull()
    expect(requests[0]?.body).toEqual(body)
  })

  test("deduplicates concurrent Codex token refreshes", async () => {
    let auth = {
      type: "oauth" as const,
      refresh: "refresh-old",
      access: "",
      expires: 0,
    }
    const authUpdates: Array<{
      body: { refresh: string; access: string; expires: number; accountId?: string }
    }> = []
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshRequests = 0
    const apiRequests: { authorization: string | null; accountId: string | null }[] = []

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/oauth/token") {
          expect(await request.text()).toContain("refresh_token=refresh-old")
          refreshRequests += 1
          await refreshReady
          return Response.json({
            id_token: createTestJwt({ chatgpt_account_id: "acc-123" }),
            access_token: "access-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
          })
        }

        if (url.pathname === "/backend-api/codex/responses") {
          apiRequests.push({
            authorization: request.headers.get("authorization"),
            accountId: request.headers.get("ChatGPT-Account-Id"),
          })
          return new Response("{}", { status: 200 })
        }

        return new Response("unexpected request", { status: 500 })
      },
    })

    const hooks = await CodexAuthPlugin(
      {
        client: {
          auth: {
            async set(input: { body: { refresh: string; access: string; expires: number; accountId?: string } }) {
              authUpdates.push(input)
              auth = {
                type: "oauth",
                refresh: input.body.refresh,
                access: input.body.access,
                expires: input.body.expires,
                ...(input.body.accountId && { accountId: input.body.accountId }),
              }
            },
          },
        } as never,
        project: {} as never,
        directory: "",
        worktree: "",
        experimental_workspace: {
          register() {},
        },
        serverUrl: new URL("https://example.com"),
        $: {} as never,
      },
      {
        issuer: server.url.origin,
        codexApiEndpoint: new URL("/backend-api/codex/responses", server.url).toString(),
      },
    )
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)

    const first = loaded.fetch!("https://api.openai.com/v1/responses")
    const second = loaded.fetch!("https://api.openai.com/v1/responses")

    await waitFor(() => refreshRequests === 1)
    expect(apiRequests).toHaveLength(0)

    resolveRefresh!()
    await Promise.all([first, second])

    expect(refreshRequests).toBe(1)
    expect(authUpdates).toHaveLength(1)
    expect(authUpdates[0]?.body.refresh).toBe("refresh-new")
    expect(authUpdates[0]?.body.access).toBe("access-new")
    expect(authUpdates[0]?.body.accountId).toBe("acc-123")
    expect(apiRequests).toEqual([
      { authorization: "Bearer access-new", accountId: "acc-123" },
      { authorization: "Bearer access-new", accountId: "acc-123" },
    ])
  })
})

async function waitFor(predicate: () => boolean) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

async function readRequestBody(request: Request) {
  const body: unknown = await request.json()
  if (!isRecord(body)) throw new Error("Expected a JSON object")
  return body
}

async function loadCodexFetch(endpoint: string) {
  const hooks = await CodexAuthPlugin({} as never, {
    codexApiEndpoint: endpoint,
  })
  const loaded = await hooks.auth!.loader!(
    async () =>
      ({
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
        accountId: "account-id",
      }) as never,
    {} as never,
  )
  if (!loaded.fetch) throw new Error("Expected a provider fetch implementation")
  return loaded.fetch
}
