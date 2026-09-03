import { Message } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { Agent } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Bus } from "@opencode-ai/core/bus"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { SnowflakeCortexPlugin } from "@opencode-ai/core/plugin/provider/snowflake-cortex"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { SessionModelRequest } from "@opencode-ai/core/session/model-request"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionRunnerRetry } from "@opencode-ai/core/session/runner/retry"
import { describe, expect } from "bun:test"
import { Clock, Effect, Layer, Schedule, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(
  Layer.merge(PluginTestLayer, SessionModelTransport.layer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))),
)
const providerID = Provider.ID.make("snowflake-cortex")
const integrationID = Integration.ID.make("snowflake-cortex")
const methodID = Integration.MethodID.make("browser")
const modelID = Model.ID.make("claude-sonnet-4-6")
const sse =
  'data: {"choices":[{"index":0,"delta":{"role":"","content":"Hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const fixture = Effect.fn(function* (settings: Provider.Settings = {}, env: Record<string, string> = {}) {
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const keys = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_CORTEX_TOKEN", "SNOWFLAKE_CORTEX_PAT"]
      const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
      keys.forEach((key) => {
        if (env[key] === undefined) delete process.env[key]
        else process.env[key] = env[key]
      })
      return previous
    }),
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
  const received: { path: string; method: string; headers: Headers; body: string }[] = []
  const urls: string[] = []
  const replies = {
    token: () => Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }),
    model: () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
  }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const path = new URL(request.url).pathname
          received.push({ path, method: request.method, headers: request.headers, body: await request.text() })
          if (path === "/oauth/token-request") return replies.token()
          if (path === "/api/v2/cortex/v1/chat/completions") return replies.model()
          return new Response("Unexpected endpoint", { status: 404 })
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  // Keep production URL construction; only redirect transport to the local fixture.
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) => {
      urls.push(request.url)
      return HttpClientRequest.setUrl(request, new URL(new URL(request.url).pathname, server.url).href)
    }),
  )
  const catalog = yield* Catalog.Service
  yield* catalog.transform((editor) => {
    editor.provider.update(providerID, (provider) => {
      provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
      provider.settings = {
        baseURL: "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1",
        ...settings,
      }
    })
    editor.model.update(providerID, modelID, () => {})
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* SnowflakeCortexPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  return { received, urls, http, replies }
})

const connect = Effect.fn(function* (answer: Record<string, string> = { account: "myorg-myaccount" }) {
  const integrations = yield* Integration.Service
  const attempt = yield* integrations.oauth.connect({ integrationID, methodID, answer })
  const url = new URL(attempt.url)
  const callback = new URL(required(url.searchParams.get("redirect_uri") ?? undefined))
  callback.searchParams.set("state", required(url.searchParams.get("state") ?? undefined))
  return { attempt, url, callback }
})

const settled = Effect.fn(function* (attemptID: Integration.AttemptID) {
  const integrations = yield* Integration.Service
  return yield* Effect.gen(function* () {
    const status = yield* integrations.oauth.status({ integrationID, attemptID })
    if (status.status === "pending") return yield* Effect.fail(new Error("Authorization pending"))
    return status
  }).pipe(Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }))
})

const login = Effect.fn(function* () {
  const flow = yield* connect()
  flow.callback.searchParams.set("code", "authorization-code")
  expect((yield* Effect.promise(() => fetch(flow.callback))).status).toBe(200)
  expect((yield* settled(flow.attempt.attemptID)).status).toBe("complete")
  return flow
})

const prepare = Effect.fn(function* () {
  const catalog = yield* Catalog.Service
  const integrations = yield* Integration.Service
  const sessions = yield* Session.Service
  const location = yield* Location.Service
  const connection = yield* integrations.connection.active(integrationID)
  const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
  const model = yield* Effect.gen(function* () {
    const model = required(yield* catalog.model.get(providerID, modelID))
    if (String(model.settings?.baseURL).includes("${")) return yield* Effect.fail(new Error("Catalog reload pending"))
    return model
  }).pipe(Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }))
  const resolved = yield* ModelResolver.fromCatalogModel(model, credential)
  expect(model.package).toBe("@opencode-ai/ai/providers/openai-compatible")
  expect(resolved.route.id).toBe("openai-compatible-chat")
  const requests = yield* SessionModelRequest.Service
  return yield* requests.prepare({
    scope: {
      session: yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) }),
      agentID: Agent.ID.make("build"),
      model: SessionRunnerModel.resolved(resolved, model),
    },
    transcript: { system: [], messages: [Message.user("Hello")] },
  })
}, Effect.provide(SessionModelRequest.layer))

function send(prepared: SessionModelRequest.Prepared, http: HttpClient.HttpClient) {
  return LLMClient.stream(prepared.request, prepared.options).pipe(
    Stream.runCollect,
    Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.fresh)),
    Effect.provideService(HttpClient.HttpClient, http),
  )
}

describe("Snowflake native provider", () => {
  it.live("registers browser/account/role and manual-token/account forms without treating account as a token", () =>
    Effect.gen(function* () {
      yield* fixture({}, { SNOWFLAKE_ACCOUNT: "myorg-myaccount" })
      const integrations = yield* Integration.Service
      const methods = required(yield* integrations.get(integrationID)).methods
      const browser = methods.find((method) => method.type === "oauth")
      const key = methods.find((method) => method.type === "key")
      expect(browser?.form?.map((field) => field.key)).toEqual(["account", "role"])
      expect(key?.form?.map((field) => field.key)).toEqual(["account"])
      expect(yield* integrations.connection.active(integrationID)).toBeUndefined()
      const aisdk = yield* AISDK.Service
      expect(
        (yield* aisdk.runSDK({
          model: Model.Info.default(providerID, modelID),
          package: "@ai-sdk/openai-compatible",
          options: {},
        })).sdk,
      ).toBeUndefined()
    }),
  )

  it.live("completes browser OAuth and makes an authenticated native request using the login account", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const hooks = yield* PluginHooks.Service
      yield* hooks.register(
        "session",
        "context",
        (event) =>
          Effect.sync(() => {
            event.generation.maxTokens = 1024
          }),
        { providerID },
      )
      const flow = yield* login()
      expect(flow.url.origin).toBe("https://myorg-myaccount.snowflakecomputing.com")
      expect(flow.url.pathname).toBe("/oauth/authorize")
      expect(flow.url.searchParams.get("client_id")).toBe("LOCAL_APPLICATION")
      expect(flow.url.searchParams.get("response_type")).toBe("code")
      expect(flow.url.searchParams.get("scope")).toBe("refresh_token")
      expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(flow.callback.hostname).toBe("127.0.0.1")
      expect(Number(flow.callback.port)).toBeGreaterThan(0)
      const exchange = required(test.received[0])
      const form = new URLSearchParams(exchange.body)
      expect(exchange.method).toBe("POST")
      expect(exchange.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("LOCAL_APPLICATION:LOCAL_APPLICATION").toString("base64")}`,
      )
      expect(exchange.headers.get("content-type")).toContain("application/x-www-form-urlencoded")
      expect(form.get("grant_type")).toBe("authorization_code")
      expect(form.get("code")).toBe("authorization-code")
      expect(form.get("client_id")).toBe("LOCAL_APPLICATION")
      expect(form.get("redirect_uri")).toBe(flow.url.searchParams.get("redirect_uri"))
      const challenge = Buffer.from(
        yield* Effect.promise(() =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(required(form.get("code_verifier") ?? undefined))),
        ),
      ).toString("base64url")
      expect(flow.url.searchParams.get("code_challenge")).toBe(challenge)
      const prepared = yield* prepare()
      const events = yield* send(prepared, test.http)
      expect(events).toContainEqual(expect.objectContaining({ type: "text-delta", text: "Hello" }))
      expect(events).toContainEqual(expect.objectContaining({ type: "finish" }))
      expect(test.urls).toEqual([
        "https://myorg-myaccount.snowflakecomputing.com/oauth/token-request",
        "https://myorg-myaccount.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
      ])
      const request = required(test.received[1])
      expect(request.headers.get("authorization")).toBe("Bearer access")
      expect(request.headers.get("user-agent")).toContain("opencode")
      const body = JSON.parse(request.body)
      expect(body.model).toBe(modelID)
      expect(body.max_completion_tokens).toBe(1024)
      expect(body).not.toHaveProperty("max_tokens")
      expect(body.stream_options.include_usage).toBe(true)
    }),
  )

  it.live("normalizes account URLs and preserves plain and encoded role scopes", () =>
    Effect.gen(function* () {
      yield* fixture()
      const plain = yield* connect({ account: " https://myorg-myaccount.snowflakecomputing.com/// ", role: " PUBLIC " })
      expect(plain.url.origin).toBe("https://myorg-myaccount.snowflakecomputing.com")
      expect(plain.url.searchParams.get("scope")).toBe("refresh_token session:role:PUBLIC")
      const encoded = yield* connect({ account: "account.us-east-1", role: "My Role" })
      expect(encoded.url.searchParams.get("scope")).toBe("refresh_token session:role-encoded:My%20Role")
      expect(encoded.url.hostname).toBe("account.us-east-1.snowflakecomputing.com")
      expect(plain.callback.port).not.toBe(encoded.callback.port)
    }),
  )

  it.live("rejects missing, empty and malformed account inputs", () =>
    Effect.gen(function* () {
      yield* fixture()
      const integrations = yield* Integration.Service
      for (const account of [
        "",
        " ",
        "https://.snowflakecomputing.com",
        "account@evil.test",
        "account/path",
        "account?x=1",
      ]) {
        const result = yield* integrations.oauth
          .connect({ integrationID, methodID, answer: { account } })
          .pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      }
    }),
  )

  for (const [params, message] of [
    [{ code: "forged", state: "wrong" }, "Invalid OAuth state"],
    [{ error: "access_denied", state: "wrong" }, "Invalid OAuth state"],
    [{ error: "access_denied", error_description: "User denied access" }, "User denied access"],
    [{}, "Missing authorization code"],
  ] as const) {
    it.live(`fails callback: ${JSON.stringify(params)}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const flow = yield* connect()
        Object.entries(params).forEach(([key, value]) => flow.callback.searchParams.set(key, value))
        expect((yield* Effect.promise(() => fetch(flow.callback))).status).toBe(400)
        expect(yield* settled(flow.attempt.attemptID)).toMatchObject({ status: "failed", message })
        expect(test.received).toHaveLength(0)
      }),
    )
  }

  it.live("cancels the attempt and closes its loopback listener", () =>
    Effect.gen(function* () {
      yield* fixture()
      const flow = yield* connect()
      const integrations = yield* Integration.Service
      yield* integrations.oauth.cancel({ integrationID, attemptID: flow.attempt.attemptID })
      const result = yield* Effect.tryPromise(() => fetch(flow.callback)).pipe(Effect.exit)
      expect(result._tag).toBe("Failure")
    }),
  )

  for (const [status, body] of [
    [400, '{"error":"invalid_grant"}'],
    [200, '{"access_token":"access"}'],
    [200, '{"refresh_token":"refresh"}'],
    [200, "not json"],
  ] as const) {
    it.live(`does not save credentials after a failed token exchange: ${status} ${body}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        test.replies.token = () => new Response(body, { status })
        const flow = yield* connect()
        flow.callback.searchParams.set("code", "authorization-code")
        yield* Effect.promise(() => fetch(flow.callback))
        expect((yield* settled(flow.attempt.attemptID)).status).toBe("failed")
        const credentials = yield* Credential.Service
        expect(yield* credentials.list(integrationID)).toEqual([])
      }),
    )
  }

  it.live("uses the account supplied with a manual PAT and follows credential switches", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const integrations = yield* Integration.Service
      yield* integrations.connection.key({
        integrationID,
        key: "pat-one",
        answer: { account: "https://first.snowflakecomputing.com/" },
      })
      yield* send(yield* prepare(), test.http)
      expect(test.urls.at(-1)).toBe("https://first.snowflakecomputing.com/api/v2/cortex/v1/chat/completions")
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer pat-one")
      yield* integrations.connection.key({ integrationID, key: "pat-two", answer: { account: "second" } })
      const catalog = yield* Catalog.Service
      yield* Effect.gen(function* () {
        if (
          (yield* catalog.model.get(providerID, modelID))?.settings?.baseURL !==
          "https://second.snowflakecomputing.com/api/v2/cortex/v1"
        )
          yield* Effect.fail(new Error("Catalog reload pending"))
      }).pipe(Effect.retry({ times: 1500, schedule: Schedule.spaced("1 millis") }))
      yield* send(yield* prepare(), test.http)
      expect(test.urls.at(-1)).toBe("https://second.snowflakecomputing.com/api/v2/cortex/v1/chat/completions")
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer pat-two")
    }),
  )

  for (const name of ["SNOWFLAKE_CORTEX_PAT", "SNOWFLAKE_CORTEX_TOKEN"]) {
    it.live(`uses ${name} with an environment account`, () =>
      Effect.gen(function* () {
        const test = yield* fixture({}, { SNOWFLAKE_ACCOUNT: "env-account", [name]: "env-token" })
        yield* send(yield* prepare(), test.http)
        expect(test.urls.at(-1)).toBe("https://env-account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions")
        expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer env-token")
      }),
    )
  }

  it.live("accepts configured account/token without environment variables", () =>
    Effect.gen(function* () {
      const test = yield* fixture({ account: "configured-account", token: "configured-token" })
      yield* send(yield* prepare(), test.http)
      expect(test.urls.at(-1)).toBe(
        "https://configured-account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
      )
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer configured-token")
    }),
  )

  it.live("preserves a configured API endpoint", () =>
    Effect.gen(function* () {
      const baseURL = "https://custom.snowflakecomputing.com/api/v2/cortex/v1"
      const test = yield* fixture({ baseURL, apiKey: "configured-key" })
      yield* send(yield* prepare(), test.http)
      expect(test.urls).toEqual([`${baseURL}/chat/completions`])
      expect(test.received[0]?.headers.get("authorization")).toBe("Bearer configured-key")
    }),
  )

  it.live("does not modify another provider's HTTP exchange", () =>
    Effect.gen(function* () {
      yield* fixture({}, { SNOWFLAKE_CORTEX_TOKEN: "snowflake-token" })
      const hooks = yield* PluginHooks.Service
      const scope = {
        sessionID: Session.ID.create(),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id: modelID }),
      }
      const request = new Request("https://api.openai.com/v1/chat/completions", {
        headers: { authorization: "Bearer other-token" },
      })
      yield* hooks.trigger("session", "http.request", { ...scope, request })
      expect(request.headers.get("authorization")).toBe("Bearer other-token")
      const response = Response.json({ message: "Conversation complete" }, { status: 400 })
      expect((yield* hooks.trigger("session", "http.response", { ...scope, request, response })).response).toBe(
        response,
      )
    }),
  )

  it.live("refreshes near-expiry tokens, retaining a refresh token when Snowflake omits a replacement", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* login()
      const credentials = yield* Credential.Service
      const saved = required((yield* credentials.list(integrationID))[0])
      if (saved.value.type !== "oauth") throw new Error("Expected OAuth")
      yield* credentials.update(saved.id, {
        value: { ...saved.value, expires: (yield* Clock.currentTimeMillis) + 60_000 },
      })
      test.replies.token = () => Response.json({ access_token: "refreshed-access" })
      yield* send(yield* prepare(), test.http)
      const form = new URLSearchParams(required(test.received[1]).body)
      expect(form.get("grant_type")).toBe("refresh_token")
      expect(form.get("refresh_token")).toBe("refresh")
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer refreshed-access")
      expect((yield* credentials.get(saved.id))?.value).toMatchObject({
        refresh: "refresh",
        access: "refreshed-access",
      })
    }),
  )

  it.live("refreshes once on 401 and lets the runner retry with the new token", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* login()
      const prepared = yield* prepare()
      test.replies.model = () => new Response("Token rejected", { status: 401 })
      const cause = yield* send(prepared, test.http).pipe(Effect.flip)
      expect(cause.reason._tag).toBe("Authentication")
      const bus = yield* Bus.Service
      const retry = yield* SessionRunnerRetry.make(bus, Session.ID.create())
      const input = {
        cause,
        error: { type: "provider.authentication", message: cause.message, status: cause.reason.http?.status },
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID, id: modelID }),
        hook: prepared.retry,
        retry: SessionRunnerRetry.isRetryable(cause),
      }
      expect(input.retry).toBe(false)
      test.replies.token = () =>
        Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 })
      expect(yield* retry.decide(input)).toEqual({ retry: true, attempt: 2, delay: 0 })
      expect(test.received.map((request) => request.path)).toEqual([
        "/oauth/token-request",
        "/api/v2/cortex/v1/chat/completions",
        "/oauth/token-request",
      ])
      test.replies.model = () => new Response(sse, { headers: { "content-type": "text/event-stream" } })
      yield* send(prepared, test.http)
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer rotated-access")
      expect(yield* retry.decide(input)).toEqual({ retry: false })
      expect(test.received).toHaveLength(4)
      const credentials = yield* Credential.Service
      expect((yield* credentials.list(integrationID))[0]?.value).toMatchObject({
        access: "rotated-access",
        refresh: "rotated-refresh",
      })
    }),
  )

  it.live("keeps environment overrides ahead of OAuth and does not refresh them on 401", () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        {},
        { SNOWFLAKE_ACCOUNT: "override", SNOWFLAKE_CORTEX_TOKEN: "env-token", SNOWFLAKE_CORTEX_PAT: "env-pat" },
      )
      yield* login()
      const prepared = yield* prepare()
      test.replies.model = () => new Response("Unauthorized", { status: 401 })
      const cause = yield* send(prepared, test.http).pipe(Effect.flip)
      const bus = yield* Bus.Service
      const retry = yield* SessionRunnerRetry.make(bus, Session.ID.create())
      expect(
        yield* retry.decide({
          cause,
          error: { type: "provider.authentication", message: cause.message, status: 401 },
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID, id: modelID }),
          hook: prepared.retry,
          retry: false,
        }),
      ).toEqual({ retry: false })
      expect(test.urls.at(-1)).toBe("https://override.snowflakecomputing.com/api/v2/cortex/v1/chat/completions")
      expect(test.received.at(-1)?.headers.get("authorization")).toBe("Bearer env-token")
      expect(test.received).toHaveLength(2)
    }),
  )

  it.live("turns conversation-complete errors into native finish events", () =>
    Effect.gen(function* () {
      const test = yield* fixture({ account: "account", apiKey: "pat" })
      test.replies.model = () => Response.json({ message: "Conversation complete" }, { status: 400 })
      const events = yield* send(yield* prepare(), test.http)
      expect(events.find((event) => event.type === "finish")?.reason.normalized).toBe("stop")
    }),
  )

  for (const [status, body] of [
    [400, '{"message":"Invalid model"}'],
    [400, "not json"],
    [500, '{"message":"Conversation complete"}'],
  ] as const) {
    it.live(`preserves other HTTP failures: ${status} ${body}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture({ account: "account", apiKey: "pat" })
        test.replies.model = () => new Response(body, { status })
        const result = yield* send(yield* prepare(), test.http).pipe(Effect.exit)
        expect(result._tag).toBe("Failure")
      }),
    )
  }
})
