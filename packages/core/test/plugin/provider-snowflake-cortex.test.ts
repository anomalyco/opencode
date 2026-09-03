import { LLM } from "@opencode-ai/ai"
import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, test } from "bun:test"
import { Effect, Schedule } from "effect"
import { Headers } from "effect/unstable/http"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SnowflakeCortexPlugin, cortexFetch } from "@opencode-ai/core/plugin/provider/snowflake-cortex"
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
})

describe("SnowflakeCortexPlugin browser OAuth", () => {
  const integrationID = Integration.ID.make("snowflake-cortex")
  const methodID = Integration.MethodID.make("browser")

  const connect = Effect.fn(function* (answer: Record<string, string>) {
    const integrations = yield* Integration.Service
    const attempt = yield* integrations.oauth.connect({ integrationID, methodID, answer })
    return { attempt, url: new URL(attempt.url) }
  })

  const settled = Effect.fn(function* (attemptID: Integration.AttemptID) {
    const integrations = yield* Integration.Service
    const status = yield* integrations.oauth.status({ integrationID, attemptID })
    if (status.status === "pending") return yield* Effect.fail(new Error("Snowflake authorization pending"))
    return status
  })

  it.effect("registers the browser login method with account and role prompts", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        {
          id: methodID,
          type: "oauth",
          label: "Login with Snowflake (External Browser)",
          form: [
            {
              type: "string",
              key: "account",
              title: "Snowflake account identifier",
              placeholder: "myorg-myaccount",
              required: true,
            },
            { type: "string", key: "role", title: "Snowflake role (optional)", placeholder: "PUBLIC" },
          ],
        },
      ])
    }),
  )

  it.effect("builds an account-specific PKCE authorize URL with a loopback redirect", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const { attempt, url } = yield* connect({ account: "myorg-myaccount" })
      expect(attempt.mode).toBe("auto")
      expect(url.origin).toBe("https://myorg-myaccount.snowflakecomputing.com")
      expect(url.pathname).toBe("/oauth/authorize")
      expect(url.searchParams.get("client_id")).toBe("LOCAL_APPLICATION")
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("scope")).toBe("refresh_token")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      expect(redirect.hostname).toBe("127.0.0.1")
      expect(redirect.pathname).toBe("/")
      expect(Number(redirect.port)).toBeGreaterThan(0)
    }),
  )

  it.effect("normalizes account URLs and encodes roles outside the identifier charset", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const plain = yield* connect({ account: "https://myorg-myaccount.snowflakecomputing.com/", role: "ANALYST" })
      expect(plain.url.origin).toBe("https://myorg-myaccount.snowflakecomputing.com")
      expect(plain.url.searchParams.get("scope")).toBe("refresh_token session:role:ANALYST")
      const quoted = yield* connect({ account: "myorg-myaccount", role: "My Role" })
      expect(quoted.url.searchParams.get("scope")).toBe("refresh_token session:role-encoded:My%20Role")
    }),
  )

  it.effect("rejects an account identifier that normalizes to nothing", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const exit = yield* integrations.oauth
        .connect({ integrationID, methodID, answer: { account: "https://.snowflakecomputing.com" } })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("resolves the catalog account template and bearer token from the OAuth credential", () =>
    withEnv({ SNOWFLAKE_ACCOUNT: undefined }, () =>
      Effect.gen(function* () {
        const resolved = yield* ModelResolver.fromCatalogModel(
          Model.Info.make({
            ...Model.Info.default(Provider.ID.make("snowflake-cortex"), Model.ID.make("claude-sonnet-4-6")),
            modelID: Model.ID.make("claude-sonnet-4-6"),
            package: Provider.aisdk("@ai-sdk/openai-compatible"),
            settings: { baseURL: "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1" },
          }),
          Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "oauth-access",
            refresh: "oauth-refresh",
            expires: Date.now() + 600_000,
            metadata: {
              account: "myorg-myaccount",
              baseURL: "https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1",
            },
          }),
        )
        expect(resolved.route.endpoint.baseURL).toBe("https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1")
        const headers = yield* resolved.route.auth.apply({
          request: LLM.request({ model: resolved, prompt: "Hello" }),
          method: "POST",
          url: "https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
          body: "{}",
          headers: Headers.empty,
        })
        expect(headers.authorization).toBe("Bearer oauth-access")
      }),
    ),
  )

  it.live("fails the attempt when the loopback callback reports a provider error", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const { attempt, url } = yield* connect({ account: "myorg-myaccount" })
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      redirect.searchParams.set("error", "access_denied")
      redirect.searchParams.set("error_description", "User denied access")
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "")
      const response = yield* Effect.promise(() => fetch(redirect))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("User denied access")
      const status = yield* settled(attempt.attemptID).pipe(
        Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }),
      )
      expect(status).toMatchObject({ status: "failed", message: "User denied access" })
    }),
  )

  it.live("rejects a loopback callback whose state does not match", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const { attempt, url } = yield* connect({ account: "myorg-myaccount" })
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
      redirect.searchParams.set("code", "forged")
      redirect.searchParams.set("state", "wrong")
      const response = yield* Effect.promise(() => fetch(redirect))
      expect(response.status).toBe(400)
      const status = yield* settled(attempt.attemptID).pipe(
        Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }),
      )
      expect(status).toMatchObject({ status: "failed", message: "Invalid OAuth state" })
    }),
  )
})

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

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
