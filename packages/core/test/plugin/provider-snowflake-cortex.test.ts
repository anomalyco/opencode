import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import {
  SnowflakeCortexPlugin,
  cortexFetch,
  normalizeAccount,
  oauthScope,
} from "@opencode-ai/core/plugin/provider/snowflake-cortex"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* SnowflakeCortexPlugin.effect(host)
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
      expect(ProviderPlugins.map((item) => item.id)).toContain("opencode.provider.snowflake.cortex")
      const ids = ProviderPlugins.map((p) => p.id)
      expect(ids.indexOf("opencode.provider.snowflake.cortex")).toBeLessThan(
        ids.indexOf("opencode.provider.openai.compatible"),
      )
    }),
  )

  it.effect("ignores non-snowflake-cortex providers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-4")),
          modelID: Model.ID.make("gpt-4"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai",
        options: { name: "openai" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("creates SDK for snowflake-cortex using SNOWFLAKE_CORTEX_PAT env var", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: "test-pat" }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("falls back to options.apiKey when SNOWFLAKE_CORTEX_PAT env var is absent", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: {
            name: "snowflake-cortex",
            baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1",
            apiKey: "options-pat",
          },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("uses SNOWFLAKE_CORTEX_TOKEN env var", () =>
    withEnv({ SNOWFLAKE_CORTEX_TOKEN: "oauth-token", SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("falls back to options.token when no Snowflake env token is set", () =>
    withEnv({ SNOWFLAKE_CORTEX_TOKEN: undefined, SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: {
            name: "snowflake-cortex",
            baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1",
            token: "options-token",
          },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )

  it.effect("sets includeUsage on the SDK options", () =>
    withEnv({ SNOWFLAKE_CORTEX_PAT: "test-pat" }, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
        })
        expect(result.options.includeUsage).toBe(true)
      }),
    ),
  )

  it.effect("registers browser OAuth method with account and role prompts", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const integration = yield* integrations.get(Integration.ID.make("snowflake-cortex"))
      const methods = integration?.methods ?? []
      expect(methods.length).toBe(1)
      const method = methods[0]
      expect(method?.type).toBe("oauth")
      if (!method || method.type !== "oauth") return
      expect(method.id).toEqual(Integration.MethodID.make("browser"))
      expect(method.label).toBe("Login with Snowflake (External Browser)")
      expect((method.form ?? []).map((field) => field.key)).toEqual(["account", "role"])
    }),
  )

  it.effect("creates SDK using stored OAuth credential when env is absent", () =>
    withEnv({ SNOWFLAKE_CORTEX_TOKEN: undefined, SNOWFLAKE_CORTEX_PAT: undefined }, () =>
      Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("snowflake-cortex"),
          value: Credential.OAuth.make({
            type: "oauth",
            methodID: Integration.MethodID.make("browser"),
            access: "oauth-access",
            refresh: "oauth-refresh",
            expires: Date.now() + 3_600_000,
            metadata: { account: "test" },
          }),
        })
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: "aisdk:test-provider",
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "snowflake-cortex", baseURL: "https://test.snowflakecomputing.com/api/v2/cortex/v1" },
        })
        expect(result.sdk).toBeDefined()
      }),
    ),
  )
})

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

describe("snowflake account helpers", () => {
  test("normalizeAccount strips URL scheme and domain suffix", () => {
    expect(normalizeAccount("https://myorg-myaccount.snowflakecomputing.com/")).toBe("myorg-myaccount")
    expect(normalizeAccount("myorg-myaccount")).toBe("myorg-myaccount")
    expect(normalizeAccount("  myorg-myaccount/ ")).toBe("myorg-myaccount")
  })

  test("oauthScope always requests refresh_token and encodes roles", () => {
    expect(oauthScope(undefined)).toBe("refresh_token")
    expect(oauthScope("PUBLIC")).toBe("refresh_token session:role:PUBLIC")
    expect(oauthScope("my role")).toBe("refresh_token session:role-encoded:my%20role")
  })
})

describe("cortexFetch", () => {
  test("rewrites max_tokens to max_completion_tokens", async () => {
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

  test("preserves body when max_tokens is absent", async () => {
    const captured: RequestInit[] = []
    const upstream: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }
    const original = JSON.stringify({ model: "claude-sonnet-4-6", temperature: 0.7 })
    await cortexFetch(upstream)("https://test", { method: "POST", body: original })
    expect(captured[0].body).toBe(original)
  })

  test("treats 400 'conversation complete' as a stop response", async () => {
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

  test("passes through other 400 errors unchanged", async () => {
    const upstream: FetchLike = async () =>
      new Response(JSON.stringify({ message: "Invalid model" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    const response = await cortexFetch(upstream)("https://test", {})
    expect(response.status).toBe(400)
  })

  test("passes through non-400 errors unchanged", async () => {
    const upstream: FetchLike = async () => new Response("Unauthorized", { status: 401 })
    const response = await cortexFetch(upstream)("https://test", {})
    expect(response.status).toBe(401)
  })

  test("handles invalid JSON body gracefully without throwing", async () => {
    const captured: RequestInit[] = []
    const upstream: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }
    const invalidBody = "{ not json }"
    await cortexFetch(upstream)("https://test", { method: "POST", body: invalidBody })
    expect(captured[0].body).toBe(invalidBody)
  })

  test("rewrites role:'' to role:'assistant' in streaming SSE chunks", async () => {
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
