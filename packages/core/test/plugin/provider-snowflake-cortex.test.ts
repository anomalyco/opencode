import { Message } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { Agent } from "@opencode-ai/core/agent"
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
import { expect } from "bun:test"
import { Effect, Layer, Schedule, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(
  Layer.merge(PluginTestLayer, SessionModelTransport.layer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))),
)
const providerID = Provider.ID.make("snowflake-cortex")
const integrationID = Integration.ID.make(providerID)
const methodID = Integration.MethodID.make("browser")
const modelID = Model.ID.make("claude-sonnet-4-6")
const env = { SNOWFLAKE_ACCOUNT: undefined, SNOWFLAKE_CORTEX_TOKEN: undefined, SNOWFLAKE_CORTEX_PAT: undefined }
const endpoint = "https://myorg-myaccount.snowflakecomputing.com"

const fixture = Effect.fn(function* () {
  const requests: Request[] = []
  const replies: Response[] = []
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      const response = replies.shift()
      if (!response) throw new Error(`Unexpected request: ${request.url}`)
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  const catalog = yield* Catalog.Service
  const integrations = yield* Integration.Service
  const sessions = yield* Session.Service
  const location = yield* Location.Service
  const hooks = yield* PluginHooks.Service
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* catalog.transform((editor) => {
    editor.provider.update(providerID, (provider) => {
      provider.package = Provider.aisdk("@ai-sdk/openai-compatible")
      provider.settings = { baseURL: "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1" }
    })
    editor.model.update(providerID, modelID, () => {})
  })
  yield* SnowflakeCortexPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
  const scope = {
    sessionID: session.id,
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID, id: modelID }),
  }
  const send = Effect.gen(function* () {
    const connection = yield* integrations.connection.active(integrationID)
    const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
    const model = yield* Effect.gen(function* () {
      const model = yield* catalog.model.get(providerID, modelID)
      if (!model || String(model.settings?.baseURL).includes("${")) return yield* Effect.fail("Catalog pending")
      return model
    }).pipe(Effect.retry({ times: 100, schedule: Schedule.spaced("1 millis") }))
    const resolved = yield* ModelResolver.fromCatalogModel(model, credential)
    const service = yield* SessionModelRequest.Service
    const prepared = yield* service.prepare({
      scope: { session, agentID: scope.agent, model: SessionRunnerModel.resolved(resolved, model) },
      transcript: { system: [], messages: [Message.user("Hello")] },
    })
    return yield* LLMClient.stream(prepared.request, prepared.options).pipe(
      Stream.runCollect,
      Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.fresh)),
      Effect.provideService(HttpClient.HttpClient, http),
    )
  }).pipe(Effect.provide(SessionModelRequest.layer))
  return { requests, replies, integrations, hooks, scope, send }
})

const status = Effect.fn(function* (attemptID: Integration.AttemptID) {
  const integrations = yield* Integration.Service
  return yield* integrations.oauth.status({ integrationID, attemptID }).pipe(
    Effect.filterOrFail(
      (status) => status.status !== "pending",
      () => "OAuth pending",
    ),
    Effect.retry({ times: 100, schedule: Schedule.spaced("1 millis") }),
  )
})

it.live("browser OAuth supplies the native endpoint/token and refreshes a rejected token once", () =>
  withEnv(env, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const attempt = yield* test.integrations.oauth.connect({
        integrationID,
        methodID,
        answer: { account: `${endpoint}///`, role: "My Role" },
      })
      const url = new URL(attempt.url)
      expect(url.origin + url.pathname).toBe(`${endpoint}/oauth/authorize`)
      expect(url.searchParams.get("scope")).toBe("refresh_token session:role-encoded:My%20Role")
      const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("state", url.searchParams.get("state") ?? "")
      callback.searchParams.set("code", "auth-code")
      test.replies.push(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }))
      yield* Effect.promise(() => fetch(callback))
      expect((yield* status(attempt.attemptID)).status).toBe("complete")
      const exchange = test.requests[0]
      expect(exchange.url).toBe(`${endpoint}/oauth/token-request`)
      expect(exchange.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("LOCAL_APPLICATION:LOCAL_APPLICATION").toString("base64")}`,
      )
      const form = new URLSearchParams(yield* Effect.promise(() => exchange.text()))
      expect(Object.fromEntries(form)).toMatchObject({
        grant_type: "authorization_code",
        code: "auth-code",
        redirect_uri: url.searchParams.get("redirect_uri"),
      })
      const challenge = Buffer.from(
        yield* Effect.promise(() =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? "")),
        ),
      ).toString("base64url")
      expect(url.searchParams.get("code_challenge")).toBe(challenge)

      test.replies.push(new Response("Unauthorized", { status: 401 }))
      expect((yield* test.send.pipe(Effect.exit))._tag).toBe("Failure")
      expect(test.requests[1].headers.get("authorization")).toBe("Bearer access")
      test.replies.push(Response.json({ access_token: "renewed", refresh_token: "", expires_in: 3600 }))
      const retry = {
        ...test.scope,
        error: { type: "provider.authentication", message: "Unauthorized", status: 401 },
        attempt: 2,
        decision: { retry: false as const },
      }
      expect((yield* test.hooks.trigger("session", "retry", retry)).decision).toEqual({ retry: true, delay: 0 })
      const refresh = new URLSearchParams(yield* Effect.promise(() => test.requests[2].text()))
      expect(Object.fromEntries(refresh)).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh" })
      test.replies.push(Response.json({ message: "Conversation complete", error: {} }, { status: 400 }))
      expect((yield* test.send).find((event) => event.type === "finish")?.reason.normalized).toBe("stop")
      expect(test.requests[3].headers.get("authorization")).toBe("Bearer renewed")
      expect(
        (yield* test.hooks.trigger("session", "retry", { ...retry, attempt: 3, decision: { retry: false } })).decision
          .retry,
      ).toBe(false)
      const credentials = yield* Credential.Service
      expect((yield* credentials.list(integrationID))[0]?.value).toMatchObject({
        access: "renewed",
        refresh: "refresh",
      })
    }),
  ),
)

it.live("manual PAT uses its account and native compatibility rather than an SDK request rewrite", () =>
  withEnv(env, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.integrations.connection.key({ integrationID, key: "pat", answer: { account: `${endpoint}/` } })
      yield* test.hooks.register(
        "session",
        "context",
        (event) =>
          Effect.sync(() => {
            event.generation.maxTokens = 1024
          }),
        { providerID },
      )
      test.replies.push(
        new Response(
          'data: {"choices":[{"index":0,"delta":{"role":"","content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      )
      expect(yield* test.send).toContainEqual(expect.objectContaining({ type: "text-delta", text: "Hello" }))
      const request = test.requests[0]
      expect(request.url).toBe(`${endpoint}/api/v2/cortex/v1/chat/completions`)
      expect(request.headers.get("authorization")).toBe("Bearer pat")
      const body = yield* Effect.promise(() => request.json())
      expect(body).toMatchObject({ model: modelID, max_completion_tokens: 1024 })
      expect(body).not.toHaveProperty("max_tokens")
    }),
  ),
)

it.live("rejects a mismatched callback state before token exchange", () =>
  withEnv(env, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const attempt = yield* test.integrations.oauth.connect({
        integrationID,
        methodID,
        answer: { account: "myorg-myaccount" },
      })
      const callback = new URL(new URL(attempt.url).searchParams.get("redirect_uri") ?? "")
      callback.searchParams.set("state", "wrong")
      callback.searchParams.set("code", "forged")
      expect((yield* Effect.promise(() => fetch(callback))).status).toBe(400)
      expect(yield* status(attempt.attemptID)).toMatchObject({ status: "failed", message: "Invalid OAuth state" })
      expect(test.requests).toHaveLength(0)
    }),
  ),
)
