import { describe, expect } from "bun:test"
import { Message } from "@opencode/ai"
import { AnthropicMessages, OpenAIResponses } from "@opencode/ai/protocols"
import { compileRequest } from "@opencode/ai/route/client"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Agent } from "@opencode/schema/agent"
import { Document, Info } from "@opencode/schema/config"
import type { ConfigCache } from "@opencode/schema/config/cache"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const session = Session.Info.make({
  id: Session.ID.make("ses_cache"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(
  AnthropicMessages.route.with({ provider: "company" }).model({ id: "claude-sonnet-4-5" }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 200_000, output: 32_000 },
  },
)
const input = { session, agent: Agent.ID.make("build"), model, system: [], messages: [Message.user("Question")] }

const setup = Effect.fn(function* (cache: ConfigCache.Info) {
  const config = yield* Config.Test
  yield* config.setEntries([new Document({ type: "document", info: Info.make({ cache }) })])
  const requests = yield* SessionModelRequest.Service.pipe(
    Effect.provide(SessionModelRequest.layer),
    Effect.provideService(
      SessionModelTransport.Service,
      SessionModelTransport.Service.of({
        bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
        close: () => Effect.void,
        closeAll: Effect.void,
      }),
    ),
  )
  return { config, requests }
})

describe("SessionModelRequest cache rules", () => {
  it.effect("selects rules using the configured provider and actual agent", () =>
    Effect.gen(function* () {
      const setupResult = yield* setup({
        company: [
          { options: {} },
          { when: { agent: "research" }, options: { cache_control: { type: "ephemeral", ttl: "1h" } } },
        ],
      })
      const prepared = yield* setupResult.requests.primary({ ...input, agent: Agent.ID.make("research") })
      expect(prepared.request.cache).toMatchObject({ ttlSeconds: 3600 })
    }),
  )

  it.effect("distinguishes a subagent from a fork", () =>
    Effect.gen(function* () {
      const setupResult = yield* setup({
        company: [
          { options: { cache_control: { type: "ephemeral", ttl: "5m" } } },
          { when: { subagent: true }, options: { cache_control: { type: "ephemeral", ttl: "1h" } } },
        ],
      })
      const child = yield* setupResult.requests.primary({
        ...input,
        session: { ...session, parentID: Session.ID.make("ses_parent") },
      })
      const fork = yield* setupResult.requests.primary({
        ...input,
        session: {
          ...session,
          fork: {
            sessionID: Session.ID.make("ses_parent"),
            boundary: { type: "through", messageID: SessionMessage.ID.create() },
          },
        },
      })
      expect(child.request.cache).toMatchObject({ ttlSeconds: 3600 })
      expect(fork.request.cache).toMatchObject({ ttlSeconds: 300 })
    }),
  )

  it.effect("rereads configuration for an existing session", () =>
    Effect.gen(function* () {
      const setupResult = yield* setup({ company: [{ options: { cache_control: { type: "ephemeral", ttl: "1h" } } }] })
      expect((yield* setupResult.requests.primary(input)).request.cache).toMatchObject({ ttlSeconds: 3600 })
      yield* setupResult.config.setEntries([])
      expect((yield* setupResult.requests.primary(input)).request.cache).toBeUndefined()
    }),
  )

  for (const kind of ["primary", "compaction", "title", "generate"] as const) {
    it.effect(`passes an OpenAI cache option through the ${kind} flow`, () =>
      Effect.gen(function* () {
        const setupResult = yield* setup({
          openai: [{ when: { model: "gpt-5.6" }, options: { prompt_cache_options: { ttl: "30m" } } }],
        })
        const prepared = yield* setupResult.requests[kind]({
          ...input,
          model: SessionRunnerModel.resolved(OpenAIResponses.route.model({ id: "gpt-5.6" }), {
            capabilities: model.capabilities,
            cost: [],
            limit: model.limit,
          }),
        })
        expect((yield* compileRequest(prepared.request)).body).toMatchObject({ prompt_cache_options: { ttl: "30m" } })
      }),
    )
  }

  it.effect("reports unsupported request routes as typed failures", () =>
    Effect.gen(function* () {
      const setupResult = yield* setup({ company: [{ options: { prompt_cache_retention: "24h" } }] })
      const error = yield* Effect.flip(setupResult.requests.primary(input))
      expect(error.reason._tag).toBe("InvalidRequest")
    }),
  )

  it.effect("reports ambiguity from programmatic config as a typed failure", () =>
    Effect.gen(function* () {
      const setupResult = yield* setup({ company: [{ options: {} }, { options: {} }] })
      const error = yield* Effect.flip(setupResult.requests.primary(input))
      expect(error.reason._tag).toBe("InvalidRequest")
      expect(error.message).toContain('cache["company"]')
    }),
  )
})
