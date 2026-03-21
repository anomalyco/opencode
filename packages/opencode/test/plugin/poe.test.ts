import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EventEmitter } from "events"
import {
  PoeAuthPlugin,
  buildAuthorizeUrl,
  escapeHtml,
  getPoeExpiry,
  resetPoeOAuthForTest,
  HTML_ERROR,
  type PkceCodes,
} from "../../src/plugin/poe"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"
import { resolvePluginProviders } from "../../src/cli/cmd/providers"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"

const fetch0 = globalThis.fetch

let openCalledWith: string | undefined

mock.module("open", () => ({
  default: async (url: string) => {
    openCalledWith = url
    return new EventEmitter()
  },
}))

function input(): PluginInput {
  return {
    client: undefined as never,
    project: undefined as never,
    worktree: undefined as never,
    directory: process.cwd(),
    serverUrl: new URL("http://localhost:4096"),
    $: Bun.$,
  }
}

describe("plugin.poe", () => {
  beforeEach(() => {
    mock.restore()
    globalThis.fetch = fetch0
    resetPoeOAuthForTest()
    openCalledWith = undefined
  })

  afterEach(async () => {
    mock.restore()
    globalThis.fetch = fetch0
    resetPoeOAuthForTest()
    await Auth.remove("poe")
  })

  test("buildAuthorizeUrl includes required OAuth params", () => {
    const pkce: PkceCodes = {
      verifier: "test-verifier",
      challenge: "test-challenge",
    }
    const url = new URL(buildAuthorizeUrl("http://127.0.0.1:4444/callback", pkce, "test-state"))

    expect(url.origin + url.pathname).toBe("https://poe.com/oauth/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4444/callback")
    expect(url.searchParams.get("scope")).toBe("apikey:create")
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe("test-state")
  })

  test("browser login tries to open the Poe authorize URL", async () => {
    const hook = await PoeAuthPlugin(input())
    const auth = hook.auth!
    const oauth = auth.methods[0]
    if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

    const grant = await oauth.authorize()
    if (grant.method !== "auto") throw new Error("Expected auto OAuth method")

    expect(openCalledWith).toBe(grant.url)

    const url = new URL(grant.url)
    const redirect = new URL(url.searchParams.get("redirect_uri")!)
    const callback = grant.callback().catch((err) => err)
    await fetch(`${redirect.origin}/cancel`)
    await callback
  })

  test("escapes html characters before rendering error page", () => {
    const err = `<script>alert("x")</script> & 'quote'`
    const page = HTML_ERROR(err)

    expect(escapeHtml(err)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;")
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quote&#39;")
    expect(page).not.toContain(err)
  })

  test("missing callback code returns an HTML error response", async () => {
    const hook = await PoeAuthPlugin(input())
    const auth = hook.auth!
    const oauth = auth.methods[0]
    if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

    const grant = await oauth.authorize()
    if (grant.method !== "auto") throw new Error("Expected auto OAuth method")

    const url = new URL(grant.url)
    const redirect = new URL(url.searchParams.get("redirect_uri")!)
    const state = url.searchParams.get("state")!
    const callback = grant.callback().catch((err) => err)
    const res = await fetch(`${redirect.origin}/callback?state=${encodeURIComponent(state)}`)

    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("text/html")
    expect(await res.text()).toContain("Missing authorization code")
    expect(await callback).toBeInstanceOf(Error)
    expect((await callback).message).toBe("Missing authorization code")
  })

  test("invalid callback state is rejected", async () => {
    const hook = await PoeAuthPlugin(input())
    const auth = hook.auth!
    const oauth = auth.methods[0]
    if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

    const grant = await oauth.authorize()
    if (grant.method !== "auto") throw new Error("Expected auto OAuth method")

    const url = new URL(grant.url)
    const redirect = new URL(url.searchParams.get("redirect_uri")!)
    const callback = grant.callback().catch((err) => err)
    const res = await fetch(`${redirect.origin}/callback?code=test-code&state=wrong-state`)

    expect(res.status).toBe(400)
    expect(await res.text()).toContain("Invalid state - potential CSRF attack")
    expect(await callback).toBeInstanceOf(Error)
    expect((await callback).message).toBe("Invalid state - potential CSRF attack")
  })

  test("valid callback resolves to Poe API key auth and browser auth shape", async () => {
    const now = 1_700_000_000_000
    const time = spyOn(Date, "now").mockImplementation(() => now)
    const mocked = mock(async (req, init) => {
      const url = typeof req === "string" ? req : req instanceof URL ? req.toString() : req.url
      if (url === "https://api.poe.com/token") {
        expect(init?.method).toBe("POST")
        const body = init?.body?.toString() ?? ""
        const params = new URLSearchParams(body)
        expect(params.get("grant_type")).toBe("authorization_code")
        expect(params.get("code")).toBe("valid-code")
        expect(params.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
        expect(params.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
        expect(params.get("code_verifier")).toBeTruthy()
        return new Response(JSON.stringify({ api_key: "poe-key", api_key_expires_in: 60 }))
      }
      return fetch0(req, init)
    })
    globalThis.fetch = mocked as unknown as typeof fetch

    try {
      const hook = await PoeAuthPlugin(input())
      const auth = hook.auth!
      const oauth = auth.methods[0]
      if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

      const grant = await oauth.authorize()
      if (grant.method !== "auto") throw new Error("Expected auto OAuth method")

      const url = new URL(grant.url)
      const redirect = new URL(url.searchParams.get("redirect_uri")!)
      const state = url.searchParams.get("state")!
      const res = await fetch(`${redirect.origin}/callback?code=valid-code&state=${encodeURIComponent(state)}`)

      expect(res.status).toBe(200)
      const result = await grant.callback()
      expect(result).toEqual({
        type: "success",
        access: "poe-key",
        refresh: "poe-key",
        expires: now + 60_000,
      })
    } finally {
      time.mockRestore()
    }
  })

  test("null Poe expiry maps to a non-expiring sentinel", () => {
    expect(
      getPoeExpiry({
        api_key: "poe-key",
        api_key_expires_in: null,
      }),
    ).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("positive Poe expiry maps from seconds onto Date.now", () => {
    const time = spyOn(Date, "now").mockImplementation(() => 12_345)

    try {
      expect(
        getPoeExpiry({
          api_key: "poe-key",
          api_key_expires_in: 42,
        }),
      ).toBe(54_345)
    } finally {
      time.mockRestore()
    }
  })

  test("loader throws a clear re-login error when Poe OAuth auth is expired", async () => {
    const hook = await PoeAuthPlugin(input())
    const auth = hook.auth!

    await expect(
      auth.loader!(
        async () => ({
          type: "oauth",
          access: "poe-key",
          refresh: "poe-key",
          expires: Date.now() - 1,
        }),
        undefined as never,
      ),
    ).rejects.toThrow("Poe API key expired. Run `opencode providers login` again.")
  })

  test("Poe is visible as an auth-capable plugin provider after registration", async () => {
    const hook = await PoeAuthPlugin(input())

    expect(
      resolvePluginProviders({
        hooks: [hook],
        existingProviders: {},
        disabled: new Set(),
        providerNames: {},
      }),
    ).toEqual([{ id: "poe", name: "poe" }])
  })

  test("ProviderAuth exposes Poe after registration", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        const poe = methods[ProviderID.make("poe")]
        expect(poe).toBeDefined()
        expect(poe[0].type).toBe("oauth")
        expect(poe[0].label).toBe("Login with Poe (browser)")
      },
    })
  })

  test("Poe OAuth auth exposes Poe models and authorizes chat requests", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(new URL(req.url).pathname).toBe("/v1/chat/completions")
        expect(req.headers.get("Authorization")).toBe("Bearer poe-key")
        await req.text()
        return new Response(
          [
            `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { role: "assistant" } }] })}`,
            `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: { content: "Hello" } }] })}`,
            `data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        )
      },
    })

    try {
      await using tmp = await tmpdir({
        config: {
          enabled_providers: ["poe"],
          provider: {
            poe: {
              options: {
                baseURL: `${server.url.origin}/v1`,
              },
            },
          },
        },
      })

      await Auth.set("poe", {
        type: "oauth",
        access: "poe-key",
        refresh: "poe-key",
        expires: Date.now() + 60_000,
      })

      const { Provider } = await import("../../src/provider/provider")
      const { ModelID, ProviderID } = await import("../../src/provider/schema")
      const { LLM } = await import("../../src/session/llm")
      const { SessionID, MessageID } = await import("../../src/session/schema")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const providers = await Provider.list()
          expect(providers[ProviderID.make("poe")]).toBeDefined()
          expect(providers[ProviderID.make("poe")].name).toBe("Poe")
          expect(providers[ProviderID.make("poe")].models["poetools/claude-code"]).toBeDefined()
          expect(providers[ProviderID.make("poe")].options.apiKey).toBe("poe-key")

          const model = await Provider.getModel(ProviderID.make("poe"), ModelID.make("poetools/claude-code"))
          const sessionID = SessionID.make("session-poe")
          const agent = {
            name: "test",
            mode: "primary",
            options: {},
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          } satisfies Agent.Info
          const user = {
            id: MessageID.make("user-poe"),
            sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: agent.name,
            model: { providerID: ProviderID.make("poe"), modelID: model.id },
          } satisfies MessageV2.User

          const result = await LLM.stream({
            user,
            sessionID,
            model,
            agent,
            system: ["You are a helpful assistant."],
            abort: new AbortController().signal,
            messages: [{ role: "user", content: "Hello" }],
            tools: {},
          })

          for await (const _ of result.fullStream) {
          }
        },
      })
    } finally {
      server.stop()
    }
  })
})
