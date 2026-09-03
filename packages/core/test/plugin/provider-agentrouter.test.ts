import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { AgentRouterPlugin } from "@opencode-ai/core/plugin/provider/agentrouter"
import { agentRouterFetch } from "@opencode-ai/core/plugin/provider/agentrouter-fetch"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { describe, expect, it as bun_it } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* AgentRouterPlugin.effect(host)
})

function model(providerID: string) {
  return ModelV2.Info.make({
    ...ModelV2.Info.empty(ProviderV2.ID.make(providerID), ModelV2.ID.make("test-model")),
    api: { id: ModelV2.ID.make("test-model"), type: "aisdk", package: "@ai-sdk/openai-compatible" },
  })
}

describe("AgentRouterPlugin", () => {
  it.effect("is registered before the SDK provider plugins", () =>
    Effect.sync(() => {
      const ids = ProviderPlugins.map((item) => item.id)
      expect(ids).toContain(PluginV2.ID.make("agentrouter"))
      expect(ids.indexOf("agentrouter")).toBeLessThan(ids.indexOf("anthropic"))
      expect(ids.indexOf("agentrouter")).toBeLessThan(ids.indexOf("openai-compatible"))
    }),
  )

  it.effect("wraps the AgentRouter fetch option", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const upstream = async () => new Response("ok")
      const result = yield* aisdk.runSDK({
        model: model("agentrouter"),
        package: "@ai-sdk/openai-compatible",
        options: { fetch: upstream },
      })
      expect(result.options.fetch).not.toBe(upstream)
    }),
  )

  it.effect("does not rewrap an already wrapped fetch option", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const upstream = agentRouterFetch(async () => new Response("ok"))
      const result = yield* aisdk.runSDK({
        model: model("agentrouter"),
        package: "@ai-sdk/openai-compatible",
        options: { fetch: upstream },
      })
      expect(result.options.fetch).toBe(upstream)
    }),
  )

  it.effect("ignores other providers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const upstream = async () => new Response("ok")
      const result = yield* aisdk.runSDK({
        model: model("openai"),
        package: "@ai-sdk/openai-compatible",
        options: { fetch: upstream },
      })
      expect(result.options.fetch).toBe(upstream)
    }),
  )
})

describe("agentRouterFetch", () => {
  bun_it("is idempotent when rewrapping", () => {
    const upstream = async () => new Response("ok")
    const wrapped = agentRouterFetch(upstream)
    expect(agentRouterFetch(wrapped)).toBe(wrapped)
  })

  bun_it("identifies requests as opencode", async () => {
    const captured: Headers[] = []
    const upstream = async (_input: string | URL | Request, init?: RequestInit) => {
      captured.push(new Headers(init?.headers))
      return new Response("{}")
    }
    await agentRouterFetch(upstream)("https://agentrouter.org/v1/models", {
      headers: { Authorization: "Bearer test-key", "User-Agent": "ai-sdk/openai-compatible" },
    })
    expect(captured[0].get("authorization")).toBe("Bearer test-key")
    expect(captured[0].get("user-agent")).toMatch(/^opencode\//)
  })

  bun_it("removes null SSE events across chunk boundaries", async () => {
    const encoder = new TextEncoder()
    const upstream = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: nu'))
            controller.enqueue(encoder.encode("ll\n\ndata: [DONE]\n\n"))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      )
    const response = await agentRouterFetch(upstream)("https://agentrouter.org/v1/chat/completions")
    const text = await response.text()
    expect(text).toContain('data: {"choices"')
    expect(text).toContain("data: [DONE]")
    expect(text).not.toContain("data: null")
  })

  bun_it("filters whitespace variants and multi-line null events", async () => {
    const encoder = new TextEncoder()
    const sseData =
      [
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        "data:   null",
        "data:null",
        "data:\tnull",
        "data: null\ndata:  null",
        'data: {"choices":[{"delta":{"content":"B"}}]}',
        "data: [DONE]",
      ].join("\n\n") + "\n\n"

    const upstream = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(sseData))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      )
    const response = await agentRouterFetch(upstream)("https://agentrouter.org/v1/chat/completions")
    const text = await response.text()
    expect(text).toContain('data: {"choices":[{"delta":{"content":"A"}}]}')
    expect(text).toContain('data: {"choices":[{"delta":{"content":"B"}}]}')
    expect(text).toContain("data: [DONE]")
    expect(text).not.toContain("null")
  })

  bun_it("preserves non-SSE responses", async () => {
    const response = new Response('{"ok":true}', { headers: { "content-type": "application/json" } })
    expect(await agentRouterFetch(async () => response)("https://agentrouter.org/v1/models")).toBe(response)
  })

  bun_it("preserves response metadata", async () => {
    const upstream = async () =>
      new Response("data: [DONE]\n\n", {
        status: 206,
        statusText: "Partial Content",
        headers: { "content-type": "text/event-stream", "x-request-id": "request-1" },
      })
    const response = await agentRouterFetch(upstream)("https://agentrouter.org/v1/chat/completions")
    expect(response.status).toBe(206)
    expect(response.statusText).toBe("Partial Content")
    expect(response.headers.get("x-request-id")).toBe("request-1")
  })

  bun_it("preserves response url", async () => {
    const upstream = async () => {
      const res = new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
      Object.defineProperty(res, "url", { value: "https://agentrouter.org/v1/chat/completions" })
      return res
    }
    const response = await agentRouterFetch(upstream)("https://agentrouter.org/v1/chat/completions")
    expect(response.url).toBe("https://agentrouter.org/v1/chat/completions")
  })
})

