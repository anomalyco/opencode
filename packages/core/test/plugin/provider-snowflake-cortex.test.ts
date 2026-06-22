import { describe, expect, it as bun_it } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SnowflakeCortexPlugin, cortexFetch } from "@opencode-ai/core/plugin/provider/snowflake-cortex"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make()
  yield* plugin.add({ id: SnowflakeCortexPlugin.id, effect: SnowflakeCortexPlugin.effect(host) })
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

describe("SnowflakeCortexPlugin", () => {
  it.effect("is registered in ProviderPlugins before OpenAICompatiblePlugin", () =>
    Effect.sync(() => {
      expect(ProviderPlugins.map((item) => item.id)).toContain(PluginV2.ID.make("snowflake-cortex"))
      const ids = ProviderPlugins.map((p) => p.id)
      expect(ids.indexOf("snowflake-cortex")).toBeLessThan(ids.indexOf("openai-compatible"))
    }),
  )

  it.effect("ignores non-snowflake-cortex providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* addPlugin()
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("openai"), ModelV2.ID.make("gpt-4")),
            api: { id: ModelV2.ID.make("gpt-4"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai",
          options: { name: "openai" },
        },
        {},
      )
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("creates SDK for snowflake-cortex using SNOWFLAKE_CORTEX_PAT env var", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: "test-pat" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* addPlugin()
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("snowflake-cortex"), ModelV2.ID.make("claude-sonnet-4-6")),
              api: { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "test-provider" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
          },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("falls back to options.apiKey when SNOWFLAKE_CORTEX_PAT env var is absent", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* addPlugin()
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("snowflake-cortex"), ModelV2.ID.make("claude-sonnet-4-6")),
              api: { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "test-provider" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: {
              name: "snowflake-cortex",
              baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1",
              apiKey: "options-pat",
            },
          },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("uses SNOWFLAKE_CORTEX_TOKEN env var", () =>
    withEnv({ SNOWFLAKE_CORTEX_TOKEN: "oauth-token", SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* addPlugin()
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("snowflake-cortex"), ModelV2.ID.make("claude-sonnet-4-6")),
              api: { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "test-provider" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
          },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("falls back to options.token when no Snowflake env token is set", () =>
    withEnv({ SNOWFLAKE_CORTEX_TOKEN: undefined, SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* addPlugin()
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("snowflake-cortex"), ModelV2.ID.make("claude-sonnet-4-6")),
              api: { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "test-provider" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: {
              name: "snowflake-cortex",
              baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1",
              token: "options-token",
            },
          },
          {},
        )
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("sets includeUsage on the SDK options", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: "test-pat" }, () =>
      Effect.gen(function* () {
        const plugin = yield* PluginV2.Service
        yield* addPlugin()
        const result = yield* plugin.trigger(
          "aisdk.sdk",
          {
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("snowflake-cortex"), ModelV2.ID.make("claude-sonnet-4-6")),
              api: { id: ModelV2.ID.make("claude-sonnet-4-6"), type: "aisdk", package: "test-provider" },
            }),
            package: "@ai-sdk/openai-compatible",
            options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
          },
          {},
        )
        expect(result.options.includeUsage).toBe(true)
      }),
    ),
  )
})

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

describe("cortexFetch", () => {
  bun_it("rewrites max_tokens to max_completion_tokens", async () => {
    const captured: RequestInit[] = []
    const upstream: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }
    await cortexFetch(upstream)("https://test", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024 }),
    })
    const body = JSON.parse(captured[0].body as string)
    expect(body.max_completion_tokens).toBe(1024)
    expect(body.max_tokens).toBeUndefined()
  })

  bun_it("preserves body when max_tokens is absent", async () => {
    const captured: RequestInit[] = []
    const upstream: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }
    const original = JSON.stringify({ model: "claude-sonnet-4-6", temperature: 0.7 })
    await cortexFetch(upstream)("https://test", { method: "POST", body: original })
    expect(captured[0].body).toBe(original)
  })

  bun_it("treats 400 'conversation complete' as a stop response", async () => {
    const upstream: FetchLike = async () =>
      new Response(JSON.stringify({ message: "Conversation complete" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    const response = await cortexFetch(upstream)("https://test", {})
    expect(response.status).toBe(200)
    const data = (await response.json()) as { choices: { finish_reason: string }[] }
    expect(data.choices[0].finish_reason).toBe("stop")
  })

  bun_it("passes through other 400 errors unchanged", async () => {
    const upstream: FetchLike = async () =>
      new Response(JSON.stringify({ message: "Invalid model" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    const response = await cortexFetch(upstream)("https://test", {})
    expect(response.status).toBe(400)
  })

  bun_it("passes through non-400 errors unchanged", async () => {
    const upstream: FetchLike = async () => new Response("Unauthorized", { status: 401 })
    const response = await cortexFetch(upstream)("https://test", {})
    expect(response.status).toBe(401)
  })

  bun_it("handles invalid JSON body gracefully without throwing", async () => {
    const captured: RequestInit[] = []
    const upstream: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }
    const invalidBody = "{ not json }"
    await cortexFetch(upstream)("https://test", { method: "POST", body: invalidBody })
    expect(captured[0].body).toBe(invalidBody)
  })

  bun_it("rewrites role:'' to role:'assistant' in streaming SSE chunks", async () => {
    const chunk = `data: {"choices":[{"delta":{"role":"","content":"Hi"},"index":0}]}\n\n`
    const upstream: FetchLike = async () =>
      new Response(
        new ReadableStream({
          start: (ctrl) => {
            ctrl.enqueue(new TextEncoder().encode(chunk))
            ctrl.close()
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      )
    const response = await cortexFetch(upstream)("https://test", {})
    const text = await response.text()
    expect(text).toContain('"role":"assistant"')
    expect(text).not.toContain('"role":""')
  })
})
