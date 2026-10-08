import { describe, expect } from "bun:test"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "@opencode/ai/protocols"
import { Message } from "@opencode/ai"
import { compileRequest } from "@opencode/ai/route/client"
import { Config } from "@opencode/core/config"
import { Document, Info } from "@opencode/schema/config"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import type { SessionRequestKind } from "@opencode/plugin/effect/session"
import { Location } from "@opencode/core/location"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { DateTime, Effect, Schema, Stream } from "effect"
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

describe("SessionModelRequest cache rules", () => {
  it.effect("resolves the actual agent, model, provider, and subagent context in every request flow", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      yield* config.setEntries([
        new Document({
          type: "document",
          info: Schema.decodeUnknownSync(Info)({
            cache: {
              company: [
                { options: { cache_control: { type: "ephemeral", ttl: "1h" } } },
                { when: { subagent: true }, options: { cache_control: { type: "ephemeral", ttl: "5m" } } },
                {
                  when: { agent: "research", subagent: true },
                  options: { cache_control: { type: "ephemeral", ttl: "1h" } },
                },
              ],
              openai: [
                { when: { model: "gpt-5.4" }, options: { prompt_cache_retention: "24h" } },
                ...["gpt-5.6", "gpt-6.1-sol"].map((model) => ({
                  when: { model },
                  options: { prompt_cache_options: { mode: "implicit", ttl: "30m" } },
                })),
              ],
            },
          }),
        }),
      ])
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const anthropic = SessionRunnerModel.resolved(
        AnthropicMessages.route.with({ provider: "company" }).model({ id: "claude-sonnet-4-5" }),
        { capabilities: model.capabilities, cost: [], limit: model.limit },
      )
      const openai = SessionRunnerModel.resolved(OpenAIResponses.route.model({ id: "gpt-5.4", provider: "openai" }), {
        capabilities: model.capabilities,
        cost: [],
        limit: model.limit,
      })
      const child = { ...session, parentID: Session.ID.make("ses_parent") }
      const fork = {
        ...session,
        fork: {
          sessionID: Session.ID.make("ses_parent"),
          boundary: { type: "through" as const, messageID: SessionMessage.ID.create() },
        },
      }
      for (const kind of KINDS) {
        for (const scenario of [
          { session, agent: "build", ttl: "1h" },
          { session: child, agent: "build", ttl: undefined },
          { session: { ...child, parentID: Session.ID.make("ses_child") }, agent: "build", ttl: undefined },
          { session: child, agent: "research", ttl: "1h" },
          { session: fork, agent: "build", ttl: "1h" },
        ]) {
          const prepared = yield* requests[kind]({
            session: scenario.session,
            agent: Agent.ID.make(scenario.agent),
            model: anthropic,
            system: [],
            messages: [Message.user("Question")],
          })
          const compiled = yield* compileRequest(prepared.request)
          expect(compiled.body).toMatchObject({
            messages: [
              {
                content: [
                  {
                    cache_control: {
                      type: "ephemeral",
                      ...(scenario.ttl ? { ttl: scenario.ttl } : {}),
                    },
                  },
                ],
              },
            ],
          })
          if (!scenario.ttl) expect(JSON.stringify(compiled.body)).not.toContain('"1h"')
        }
        const prepared = yield* requests[kind]({
          session: child,
          agent: Agent.ID.make("research"),
          model: openai,
          system: [],
          messages: [Message.user("Question")],
        })
        expect((yield* compileRequest(prepared.request)).body).toMatchObject({ prompt_cache_retention: "24h" })
        for (const id of ["gpt-5.6", "gpt-6.1-sol"]) {
          const newer = yield* requests[kind]({
            session: child,
            agent: Agent.ID.make("research"),
            model: SessionRunnerModel.resolved(OpenAIResponses.route.model({ id }), {
              capabilities: model.capabilities,
              cost: [],
              limit: model.limit,
            }),
            system: [],
            messages: [Message.user("Question")],
          })
          const compiled = yield* compileRequest(newer.request)
          expect(compiled.body).toMatchObject({ prompt_cache_options: { mode: "implicit", ttl: "30m" } })
          expect(compiled.body).not.toHaveProperty("prompt_cache_retention")
        }
      }
      // A resumed session uses the current configuration, not the first request's selection.
      yield* config.setEntries([])
      const reloaded = yield* requests.primary({
        session: child,
        agent: Agent.ID.make("research"),
        model: openai,
        system: [],
        messages: [Message.user("Continue")],
      })
      expect((yield* compileRequest(reloaded.request)).body).not.toHaveProperty("prompt_cache_retention")
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
})

describe("SessionModelRequest HTTP hooks", () => {
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
        const prepared = yield* requests[kind]({
          session,
          agent: Agent.ID.make("build"),
          model,
          system: [],
          messages: [],
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

  it.effect("offers the WebSocket executor alongside HTTP hooks and routes the WebSocket hooks", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: string[] = []
      yield* hooks.register("session", "http.request", () => Effect.sync(() => void seen.push("http.request")))
      yield* hooks.register("session", "experimental.ws.handshake", (event) =>
        Effect.sync(() => {
          seen.push(`handshake:${event.kind}:${event.url}`)
          event.headers.authorization = "Bearer minted"
          delete event.headers["api-key"]
        }),
      )
      yield* hooks.register("session", "experimental.ws.send", (event) =>
        Effect.sync(() => {
          seen.push(`send:${event.kind}:${event.frame}`)
          event.frame = `${event.frame}+plugin`
        }),
      )
      yield* hooks.register("session", "experimental.ws.receive", (event) =>
        Effect.sync(() => {
          seen.push(`receive:${event.kind}:${event.frame}`)
          event.frame = event.frame.toUpperCase()
        }),
      )
      const bound: Array<{ url: string; headers: Record<string, string> }> = []
      const frames: string[] = []
      const websocketTransport = SessionModelTransport.Service.of({
        bind: (_sessionID, interceptor) => ({
          execute: () =>
            Effect.gen(function* () {
              if (!interceptor?.handshake || !interceptor.send || !interceptor.receive)
                throw new Error("Expected a full WebSocket interceptor")
              bound.push(
                yield* interceptor.handshake({ url: "wss://example.test/v1/responses", headers: { "api-key": "k" } }),
              )
              frames.push(yield* interceptor.send("create"))
              frames.push(yield* interceptor.receive("created"))
              return { frames: Stream.empty, complete: Effect.void }
            }),
        }),
        close: () => Effect.void,
        closeAll: Effect.void,
      })
      const requests = yield* SessionModelRequest.Service.pipe(
        Effect.provide(SessionModelRequest.layer),
        Effect.provideService(SessionModelTransport.Service, websocketTransport),
      )
      const prepared = yield* requests.primary({
        session,
        agent: Agent.ID.make("build"),
        model: SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          cost: [],
          limit: { context: 200_000, output: 32_000 },
          transport: "websocket",
        }),
        system: [],
        messages: [],
        webSocket: "session",
      })

      expect(prepared.options.http).toBeDefined()
      expect(prepared.options.webSocket).toBeDefined()
      yield* prepared.options.webSocket!.execute({} as never)
      expect(bound).toEqual([{ url: "wss://example.test/v1/responses", headers: { authorization: "Bearer minted" } }])
      expect(frames).toEqual(["create+plugin", "CREATED"])
      expect(seen).toEqual([
        "handshake:primary:wss://example.test/v1/responses",
        "send:primary:create",
        "receive:primary:created",
      ])
    }),
  )
})
