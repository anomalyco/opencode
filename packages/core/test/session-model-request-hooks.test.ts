import { describe, expect } from "bun:test"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { LLMClient } from "@opencode-ai/ai"
import { RequestExecutor } from "@opencode-ai/ai/route"
import { Agent } from "@opencode-ai/schema/agent"
import { Document, Info } from "@opencode-ai/schema/config"
import { Money } from "@opencode-ai/schema/money"
import { Session } from "@opencode-ai/schema/session"
import type { SessionRequestKind } from "@opencode-ai/plugin/effect/session"
import { Location } from "@opencode-ai/core/location"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { Credential } from "@opencode-ai/core/credential"
import { Generate } from "@opencode-ai/core/generate"
import { Integration } from "@opencode-ai/core/integration"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CoherePlugin } from "@opencode-ai/core/plugin/provider/cohere"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { ProviderOAuth } from "@opencode-ai/core/provider-oauth"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionModelRequest } from "@opencode-ai/core/session/model-request"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ConfigProvider, DateTime, Effect, Schema } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

const KINDS: ReadonlyArray<SessionRequestKind> = ["primary", "compaction", "title", "generate"]

const session = Session.Info.make({
  id: Session.ID.make("ses_hook_kind"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})

describe("SessionModelRequest HTTP hooks", () => {
  it.live("uses configured OAuth for all request kinds without persisting tokens", () =>
    Effect.gen(function* () {
      const tokens: string[] = []
      const calls: Array<{ auth: string | null; key: string | null; hook: string | null; body: string }> = []
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(request) {
              if (new URL(request.url).pathname === "/token") {
                tokens.push(`token-${tokens.length + 1}`)
                return Response.json({ access_token: tokens.at(-1), token_type: "Bearer", expires_in: 3600 })
              }
              calls.push({
                auth: request.headers.get("authorization"),
                key: request.headers.get("x-api-key"),
                hook: request.headers.get("x-hook"),
                body: await request.text(),
              })
              if (request.headers.get("authorization") === "Bearer token-1")
                return new Response("expired", { status: 401 })
              return new Response(
                [
                  'data: {"id":"test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
                  'data: {"id":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
                  "data: [DONE]\n\n",
                ].join(""),
                { headers: { "content-type": "text/event-stream" } },
              )
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const entries = [
        new Document({
          type: "document",
          info: Schema.decodeUnknownSync(Info)({
            providers: {
              corporate: {
                package: "@opencode-ai/ai/providers/openai-compatible",
                settings: { baseURL: new URL("/v1", server.url).href, apiKey: "old-configured-key" },
                headers: { Authorization: "Bearer old-header", "X-API-Key": "old-header-key" },
                oauth: {
                  grantType: "client_credentials",
                  tokenUrl: new URL("/token", server.url).href,
                  clientId: "client",
                  clientSecret: "private-client-secret",
                },
                models: { chat: {} },
              },
            },
          }),
        }),
      ]
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const host = yield* PluginHost.make(plugins)
        yield* ConfigProviderPlugin.Plugin.effect(host)
        const catalog = yield* Catalog.Service
        const selected = (yield* catalog.model.available()).find((model) => model.providerID === "corporate")
        if (!selected) throw new Error("Expected configured model")
        expect(JSON.stringify(yield* catalog.provider.all())).not.toContain("private-client-secret")
        expect(JSON.stringify(selected)).not.toContain("private-client-secret")
        const credentials = yield* Credential.Service
        const saved = yield* credentials.create({
          integrationID: Integration.ID.make(selected.providerID),
          value: Credential.Key.make({ type: "key", key: "saved-key" }),
        })
        const resolver = yield* ModelResolver.Service.pipe(Effect.provide(ModelResolver.layer))
        const resolved = yield* resolver.resolveModel(selected)
        expect(tokens).toEqual([])
        const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
        const unhooked = yield* requests.prepare({
          kind: "primary",
          scope: {
            session,
            agentID: Agent.ID.make("build"),
            model: { ...resolved, capabilities: { ...resolved.capabilities, responsesWebsockets: true } },
          },
          transcript: { system: [], messages: [] },
          webSocket: "session",
        })
        expect(unhooked.options.http).toBe(resolved.http)
        expect(unhooked.options.webSocket).toBeUndefined()
        const hooks = yield* PluginHooks.Service
        const seen: SessionRequestKind[] = []
        yield* hooks.register("session", "http.request", (event) =>
          Effect.sync(() => event.request.headers.set("x-hook", "present")),
        )
        yield* hooks.register("session", "http.response", (event) =>
          Effect.sync(() => {
            seen.push(event.kind)
          }),
        )
        const llm = yield* LLMClient.Service.pipe(
          Effect.provide(LLMClient.layer),
          Effect.provide(RequestExecutor.layer),
        )
        for (const kind of KINDS) {
          const prepared = yield* requests.prepare({
            kind,
            scope: {
              session,
              agentID: Agent.ID.make("build"),
              model: { ...resolved, capabilities: { ...resolved.capabilities, responsesWebsockets: true } },
            },
            transcript: { system: [], messages: [] },
            webSocket: "session",
          })
          expect(prepared.options.webSocket).toBeUndefined()
          expect((yield* llm.generate(prepared.request, prepared.options)).text).toBe("ok")
        }
        const generate = yield* Generate.Service.pipe(
          Effect.provide(Generate.layer),
          Effect.provideService(ModelResolver.Service, resolver),
          Effect.provideService(LLMClient.Service, llm),
        )
        expect(yield* generate.text({ model: resolved.ref, prompt: "hello" })).toBe("ok")
        expect(tokens).toHaveLength(2)
        expect(calls).toHaveLength(6)
        expect(calls[0]?.body).toBe(calls[1]?.body)
        expect(calls.every((call) => call.key === null && !call.body.includes("private-client-secret"))).toBe(true)
        expect(calls.slice(1).every((call) => call.auth === "Bearer token-2")).toBe(true)
        expect(calls.slice(0, 5).every((call) => call.hook === "present")).toBe(true)
        expect(seen).toEqual([...KINDS])
        expect(yield* credentials.list(Integration.ID.make(selected.providerID))).toEqual([saved])

        yield* CoherePlugin.effect(host)
        expect(
          yield* resolver.resolveModel({ ...selected, package: "aisdk:@ai-sdk/cohere" }).pipe(Effect.flip),
        ).toBeInstanceOf(ModelResolver.UnsupportedOAuthPackageError)
      }).pipe(
        Effect.provide(ProviderOAuth.layer),
        Effect.provide(Config.testLayer(entries)),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { OPENCODE_EXPERIMENTAL_CORPORATE_RESPONSES_WEBSOCKET: "true" } }),
          ),
        ),
      )
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )

  it.effect("tags every Session request kind on http.request and http.response", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: Array<{ hook: string; kind: SessionRequestKind; agent: Agent.ID }> = []
      yield* hooks.register("session", "http.request", (event) =>
        Effect.sync(() => {
          seen.push({ hook: "request", kind: event.kind, agent: event.agent })
        }),
      )
      yield* hooks.register("session", "http.response", (event) =>
        Effect.sync(() => {
          seen.push({ hook: "response", kind: event.kind, agent: event.agent })
        }),
      )
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))

      for (const kind of KINDS) {
        const prepared = yield* requests.prepare({
          kind,
          scope: { session, agentID: Agent.ID.make("build"), model },
          transcript: { system: [], messages: [] },
        })
        const http = prepared.options.http
        if (!http) throw new Error(`Expected HTTP middleware for ${kind}`)
        yield* http(HttpClientRequest.post("https://example.test/v1/chat/completions"), (request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))),
        )
      }

      expect(seen).toEqual(
        KINDS.flatMap((kind) => [
          { hook: "request", kind, agent: Agent.ID.make("build") },
          { hook: "response", kind, agent: Agent.ID.make("build") },
        ]),
      )
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
})
