import { afterEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "events"
import { PoeAuthPlugin } from "../../src/plugin/poe"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"
import { resolvePluginProviders } from "../../src/cli/cmd/providers"
import type { PluginInput } from "@opencode-ai/plugin"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"

mock.module("open", () => ({
  default: async (_url: string) => new EventEmitter(),
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
  afterEach(async () => {
    await Auth.remove("poe")
  })

  test("loader returns apiKey for API auth type", async () => {
    const hook = await PoeAuthPlugin(input())
    const result = await hook.auth!.loader!(async () => ({ type: "api", key: "sk-poe-test" }), undefined as never)
    expect(result).toEqual({ apiKey: "sk-poe-test" })
  })

  test("loader returns apiKey for valid OAuth auth", async () => {
    const hook = await PoeAuthPlugin(input())
    const result = await hook.auth!.loader!(
      async () => ({ type: "oauth", access: "poe-key", refresh: "poe-key", expires: Date.now() + 60_000 }),
      undefined as never,
    )
    expect(result).toEqual({ apiKey: "poe-key" })
  })

  test("loader returns empty for unknown auth type", async () => {
    const hook = await PoeAuthPlugin(input())
    const result = await hook.auth!.loader!(async () => ({ type: "unknown" }) as never, undefined as never)
    expect(result).toEqual({})
  })

  test("loader throws when OAuth auth is expired", async () => {
    const hook = await PoeAuthPlugin(input())
    await expect(
      hook.auth!.loader!(
        async () => ({ type: "oauth", access: "poe-key", refresh: "poe-key", expires: Date.now() - 1 }),
        undefined as never,
      ),
    ).rejects.toThrow("Poe API key expired")
  })

  test("browser login opens the Poe authorize URL and returns auto method", async () => {
    const hook = await PoeAuthPlugin(input())
    const oauth = hook.auth!.methods[0]
    if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

    const grant = await oauth.authorize()
    if (grant.method !== "auto") throw new Error("Expected auto method")

    const url = new URL(grant.url)
    expect(url.origin + url.pathname).toBe("https://poe.com/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe("apikey:create")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBeTruthy()
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  test("valid callback resolves to Poe API key auth shape", async () => {
    const fetch0 = globalThis.fetch
    const now = 1_700_000_000_000
    const spy = mock(() => now)
    Date.now = spy

    globalThis.fetch = mock(async (req, init) => {
      const url = typeof req === "string" ? req : req instanceof URL ? req.toString() : (req as Request).url
      if (url === "https://api.poe.com/token") {
        expect(init?.method).toBe("POST")
        const params = new URLSearchParams(init?.body?.toString() ?? "")
        expect(params.get("grant_type")).toBe("authorization_code")
        expect(params.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
        expect(params.get("code_verifier")).toBeTruthy()
        return new Response(JSON.stringify({ api_key: "poe-key", api_key_expires_in: 60 }))
      }
      return fetch0(req as Parameters<typeof fetch>[0], init)
    }) as unknown as typeof fetch

    try {
      const hook = await PoeAuthPlugin(input())
      const oauth = hook.auth!.methods[0]
      if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

      const grant = await oauth.authorize()
      if (grant.method !== "auto") throw new Error("Expected auto method")

      const redirectUri = new URL(new URL(grant.url).searchParams.get("redirect_uri")!)
      const callbackPromise = grant.callback()
      const res = await fetch(`${redirectUri.origin}/callback?code=valid-code`)
      expect(res.status).toBe(200)

      const result = await callbackPromise
      expect(result).toEqual({
        type: "success",
        access: "poe-key",
        refresh: "poe-key",
        expires: now + 60_000,
      })
    } finally {
      globalThis.fetch = fetch0
      Date.now = Date.now.bind(Date)
    }
  })

  test("null expiry maps to MAX_SAFE_INTEGER sentinel", async () => {
    const fetch0 = globalThis.fetch
    globalThis.fetch = mock(async (req, init) => {
      const url = typeof req === "string" ? req : req instanceof URL ? req.toString() : (req as Request).url
      if (url === "https://api.poe.com/token")
        return new Response(JSON.stringify({ api_key: "poe-key", api_key_expires_in: null }))
      return fetch0(req as Parameters<typeof fetch>[0], init)
    }) as unknown as typeof fetch

    try {
      const hook = await PoeAuthPlugin(input())
      const oauth = hook.auth!.methods[0]
      if (oauth.type !== "oauth") throw new Error("Expected OAuth method")

      const grant = await oauth.authorize()
      if (grant.method !== "auto") throw new Error("Expected auto method")

      const redirectUri = new URL(new URL(grant.url).searchParams.get("redirect_uri")!)
      const callbackPromise = grant.callback()
      await fetch(`${redirectUri.origin}/callback?code=valid-code`)

      const result = await callbackPromise
      if (result.type !== "success" || !("expires" in result)) throw new Error("Expected success with expires")
      expect(result.expires).toBe(Number.MAX_SAFE_INTEGER)
    } finally {
      globalThis.fetch = fetch0
    }
  })

  test("Poe is visible as an auth-capable plugin provider", async () => {
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
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        )
      },
    })

    try {
      await using tmp = await tmpdir({
        config: {
          enabled_providers: ["poe"],
          provider: {
            poe: { options: { baseURL: `${server.url.origin}/v1` } },
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
