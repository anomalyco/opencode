import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SnowflakeCortexPlugin, cortexFetch } from "@opencode-ai/core/plugin/provider/snowflake-cortex"
import { ProviderPlugins } from "@opencode-ai/core/plugin/provider"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const integrationID = Integration.ID.make("snowflake-cortex")
const providerID = Provider.ID.make("snowflake-cortex")
const browserMethodID = Integration.MethodID.make("browser")
const templateURL = "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1"

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* SnowflakeCortexPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function eventually<A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  remaining = 1000,
): Effect.Effect<A, Error> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (remaining === 0) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, remaining - 1)
  })
}

const connect = (answer: Record<string, string>) =>
  Effect.gen(function* () {
    const integrations = yield* Integration.Service
    const attempt = yield* integrations.oauth.connect({ integrationID, methodID: browserMethodID, answer })
    return { attempt, url: new URL(attempt.url) }
  })

const seedCatalog = Effect.gen(function* () {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((editor) => {
    editor.provider.update(providerID, (provider) => {
      provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
      provider.settings = { baseURL: templateURL }
    })
    editor.model.update(providerID, Model.ID.make("claude-sonnet-4-6"), () => {})
  })
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

  it.effect("registers the browser OAuth method with account and role prompts", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        {
          id: browserMethodID,
          type: "oauth",
          label: "Login with Snowflake (browser)",
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

  it.live("authorizes against the account issuer with PKCE and a loopback redirect", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const { attempt, url } = yield* connect({
        account: "https://myorg-myaccount.snowflakecomputing.com/",
        role: "ANALYST",
      })
      expect(url.origin).toBe("https://myorg-myaccount.snowflakecomputing.com")
      expect(url.pathname).toBe("/oauth/authorize")
      expect(url.searchParams.get("client_id")).toBe("LOCAL_APPLICATION")
      expect(url.searchParams.get("response_type")).toBe("code")
      expect(url.searchParams.get("scope")).toBe("refresh_token session:role:ANALYST")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const redirect = new URL(required(url.searchParams.get("redirect_uri") ?? undefined))
      expect(redirect.hostname).toBe("127.0.0.1")
      expect(redirect.pathname).toBe("/")
      expect(attempt.mode).toBe("auto")

      // The loopback listener is live and rejects callbacks that do not carry our state.
      const response = yield* Effect.promise(() => fetch(`${redirect.origin}/?code=stolen&state=forged`))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.text())).toContain("Invalid OAuth state")
      const status = yield* eventually(
        integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }),
        (status) => status.status === "failed",
      )
      expect(status).toMatchObject({ status: "failed", message: "Invalid OAuth state" })
    }),
  )

  it.live("uses the encoded role scope for roles that are not plain identifiers", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      const { attempt, url } = yield* connect({ account: "myorg-myaccount", role: "my role" })
      expect(url.searchParams.get("scope")).toBe("refresh_token session:role-encoded:my%20role")
      yield* integrations.oauth.cancel({ integrationID, attemptID: attempt.attemptID })

      const plain = yield* connect({ account: "myorg-myaccount" })
      expect(plain.url.searchParams.get("scope")).toBe("refresh_token")
      yield* integrations.oauth.cancel({ integrationID, attemptID: plain.attempt.attemptID })
    }),
  )

  it.effect("rejects a blank account", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const error = yield* connect({ account: "https://.snowflakecomputing.com" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(Integration.AuthorizationError)
      expect(String((error as Integration.AuthorizationError).cause)).toContain("Snowflake account is required")
    }),
  )

  it.effect("expands the account into the Cortex endpoint under a browser login", () =>
    Effect.gen(function* () {
      yield* seedCatalog
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: browserMethodID,
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 3_600_000,
          metadata: { account: "myorg-myaccount" },
        }),
      })
      yield* addPlugin()

      expect(required(yield* catalog.provider.get(providerID)).settings).toMatchObject({
        baseURL: "https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1",
      })
      expect(required(yield* catalog.model.get(providerID, Model.ID.make("claude-sonnet-4-6"))).settings).toMatchObject(
        { baseURL: "https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1" },
      )
    }),
  )

  it.effect("keeps the SNOWFLAKE_ACCOUNT template under an API key connection", () =>
    Effect.gen(function* () {
      yield* seedCatalog
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* credentials.create({ integrationID, value: Credential.Key.make({ type: "key", key: "pat" }) })
      yield* addPlugin()

      expect(required(yield* catalog.provider.get(providerID)).settings).toMatchObject({ baseURL: templateURL })
    }),
  )

  it.live("re-expands the endpoint when the active connection changes", () =>
    Effect.gen(function* () {
      yield* seedCatalog
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* addPlugin()
      expect(required(yield* catalog.provider.get(providerID)).settings).toMatchObject({ baseURL: templateURL })

      // Far enough out that Integration does not try to refresh (and hit the network) on resolve.
      yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: browserMethodID,
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 3_600_000,
          metadata: { account: "switched-account" },
        }),
      })
      yield* eventually(
        catalog.provider.get(providerID),
        (provider) =>
          provider?.settings?.baseURL === "https://switched-account.snowflakecomputing.com/api/v2/cortex/v1",
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
