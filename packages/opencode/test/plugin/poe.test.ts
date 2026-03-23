import { afterEach, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "events"
import { PoeAuthPlugin } from "../../src/plugin/poe"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
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

async function makeOAuth() {
  const hook = await PoeAuthPlugin(input())
  const method = hook.auth!.methods[0]
  if (method.type !== "oauth") throw new Error("Expected OAuth method")
  return { hook, method }
}

function mockTokenFetch(response: object) {
  const real = globalThis.fetch
  globalThis.fetch = mock(async (req, init) => {
    const url = typeof req === "string" ? req : req instanceof URL ? req.toString() : (req as Request).url
    if (url === "https://api.poe.com/token") return new Response(JSON.stringify(response))
    return real(req as Parameters<typeof fetch>[0], init)
  }) as unknown as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

describe("plugin.poe", () => {
  afterEach(async () => {
    await Auth.remove("poe")
  })

  test("loader: api key", async () => {
    const hook = await PoeAuthPlugin(input())
    expect(await hook.auth!.loader!(async () => ({ type: "api", key: "sk-test" }), undefined as never)).toEqual({
      apiKey: "sk-test",
    })
  })

  test("loader: valid oauth", async () => {
    const hook = await PoeAuthPlugin(input())
    expect(
      await hook.auth!.loader!(
        async () => ({ type: "oauth", access: "poe-key", refresh: "poe-key", expires: Date.now() + 60_000 }),
        undefined as never,
      ),
    ).toEqual({ apiKey: "poe-key" })
  })

  test("loader: expired oauth throws", async () => {
    const hook = await PoeAuthPlugin(input())
    await expect(
      hook.auth!.loader!(
        async () => ({ type: "oauth", access: "poe-key", refresh: "poe-key", expires: Date.now() - 1 }),
        undefined as never,
      ),
    ).rejects.toThrow("Poe API key expired")
  })

  test("authorize: returns correct client_id and redirect_uri", async () => {
    const { method } = await makeOAuth()
    const grant = await method.authorize()
    if (grant.method !== "auto") throw new Error("Expected auto method")
    const url = new URL(grant.url)
    expect(url.searchParams.get("client_id")).toBe("client_728290227fc048cc9262091a1ea197ea")
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  test("callback: resolves access/refresh/expires from token response", async () => {
    const restore = mockTokenFetch({ api_key: "poe-key", api_key_expires_in: 60 })
    const now = 1_700_000_000_000
    const origNow = Date.now
    Date.now = () => now

    try {
      const { method } = await makeOAuth()
      const grant = await method.authorize()
      if (grant.method !== "auto") throw new Error("Expected auto method")
      const redirectUri = new URL(new URL(grant.url).searchParams.get("redirect_uri")!)
      const done = grant.callback()
      await fetch(`${redirectUri.origin}/callback?code=valid-code`)
      expect(await done).toEqual({ type: "success", access: "poe-key", refresh: "poe-key", expires: now + 60_000 })
    } finally {
      Date.now = origNow
      restore()
    }
  })

  test("callback: null expiry maps to MAX_SAFE_INTEGER", async () => {
    const restore = mockTokenFetch({ api_key: "poe-key", api_key_expires_in: null })
    try {
      const { method } = await makeOAuth()
      const grant = await method.authorize()
      if (grant.method !== "auto") throw new Error("Expected auto method")
      const redirectUri = new URL(new URL(grant.url).searchParams.get("redirect_uri")!)
      const done = grant.callback()
      await fetch(`${redirectUri.origin}/callback?code=valid-code`)
      const result = await done
      if (result.type !== "success" || !("expires" in result)) throw new Error("Expected success with expires")
      expect(result.expires).toBe(Number.MAX_SAFE_INTEGER)
    } finally {
      restore()
    }
  })

  test("plugin provider registration", async () => {
    const hook = await PoeAuthPlugin(input())
    expect(
      resolvePluginProviders({ hooks: [hook], existingProviders: {}, disabled: new Set(), providerNames: {} }),
    ).toEqual([{ id: "poe", name: "poe" }])
  })

  test("end-to-end: Poe models load and chat requests are authorized", async () => {
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
          provider: { poe: { options: { baseURL: `${server.url.origin}/v1` } } },
        },
      })

      await Auth.set("poe", { type: "oauth", access: "poe-key", refresh: "poe-key", expires: Date.now() + 60_000 })

      const { Provider } = await import("../../src/provider/provider")
      const { ModelID, ProviderID } = await import("../../src/provider/schema")
      const { LLM } = await import("../../src/session/llm")
      const { SessionID, MessageID } = await import("../../src/session/schema")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const providers = await Provider.list()
          expect(providers[ProviderID.make("poe")]?.options.apiKey).toBe("poe-key")

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

          for await (const _ of (
            await LLM.stream({
              user,
              sessionID,
              model,
              agent,
              system: ["You are a helpful assistant."],
              abort: new AbortController().signal,
              messages: [{ role: "user", content: "Hello" }],
              tools: {},
            })
          ).fullStream) {
          }
        },
      })
    } finally {
      server.stop()
    }
  })
})
