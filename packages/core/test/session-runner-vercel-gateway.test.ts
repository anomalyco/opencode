import { VercelAIGateway } from "@opencode/ai/providers/vercel-ai-gateway"
import { LanguageModel } from "@opencode/ai/effect"
import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { testEffect } from "./lib/effect"
import { assistant, seedSession, sessionRunnerTestLayer } from "./lib/session-runner-harness"

const sessionID = Session.ID.make("ses_runner_vercel_gateway")

// The Gateway bills in USD strings while the catalog is a per-million-token price. Keep them far apart
// so a test that prices from the catalog can never look like it used the billed amount.
const catalog = (model: LanguageModel) =>
  SessionRunnerModel.resolved(model, {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [
      {
        input: Money.USDPerMillionTokens.make(10),
        output: Money.USDPerMillionTokens.make(50),
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      },
    ],
    limit: { context: 200_000, output: 20_000 },
  })

const gateway = VercelAIGateway.configure({ apiKey: "fixture" })
const messages = gateway.messages("anthropic/claude-sonnet-5.5")
// A route-provider alias: the catalog says `vercel` while the Gateway route still reads its own metadata key.
const alias = LanguageModel.update(messages, { provider: Provider.ID.make("vercel") })

const sse = (frames: ReadonlyArray<unknown>) =>
  frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")

const respond = (body: string) =>
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    ),
  )

const llmClient = (body: string) =>
  LLMClient.layer.pipe(
    Layer.provide(RequestExecutor.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, respond(body))),
  )

const suite = (model: LanguageModel, body: string) =>
  testEffect(
    sessionRunnerTestLayer(
      {
        llmClient: llmClient(body),
        models: Layer.mock(SessionRunnerModel.Service)({ resolve: () => Effect.succeed(catalog(model)) }),
      },
      SessionTransfer.node,
    ),
  )

describe("SessionRunnerLLM Vercel AI Gateway", () => {
  suite(
    alias,
    sse([
      {
        type: "message_start",
        message: {
          usage: { input_tokens: 1000, output_tokens: 0 },
          provider_metadata: { gateway: { generationId: "gen_01MOCKGENERATIONID" } },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 100 },
        provider_metadata: {
          gateway: {
            cost: "0.0207155",
            routing: { finalProvider: "anthropic", resolvedProvider: "anthropic" },
          },
        },
      },
      { type: "message_stop" },
    ]),
  ).effect("persists the billed Messages cost and Gateway routing", () =>
    Effect.gen(function* () {
      const { session } = yield* seedSession(sessionID)
      yield* session.resume(sessionID)

      const info = yield* session.get(sessionID)
      expect(info.cost).toBe(Money.USD.make(0.0207155))

      const message = assistant(yield* session.messages({ sessionID, order: "asc" }))
      expect(message.cost).toBe(Money.USD.make(0.0207155))
      expect(message.tokens).toEqual({ input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } })
      expect(message.finish).toBe("stop")
      expect(message.native).toEqual({
        gateway: {
          cost: "0.0207155",
          generationId: "gen_01MOCKGENERATIONID",
          routing: { finalProvider: "anthropic", resolvedProvider: "anthropic" },
        },
      })

      const transfer = yield* SessionTransfer.Service
      const exported = yield* transfer.export({ sessionID })
      expect(exported.info.cost).toBe(Money.USD.make(0.0207155))
      const exportedMessage = assistant(exported.messages)
      expect(exportedMessage.cost).toBe(Money.USD.make(0.0207155))
      expect(exportedMessage.tokens).toEqual({
        input: 1000,
        output: 100,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      })
      expect(exportedMessage.finish).toBe("stop")
      expect(exportedMessage.native).toEqual({
        gateway: {
          cost: "0.0207155",
          generationId: "gen_01MOCKGENERATIONID",
          routing: { finalProvider: "anthropic", resolvedProvider: "anthropic" },
        },
      })
    }),
  )

  suite(
    messages,
    sse([
      {
        type: "message_start",
        message: {
          usage: { input_tokens: 1000, output_tokens: 0 },
          provider_metadata: { gateway: { generationId: "gen_empty_cost" } },
        },
      },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 100 },
        provider_metadata: {
          gateway: { cost: "", routing: { finalProvider: "vertex" } },
        },
      },
      { type: "message_stop" },
    ]),
  ).effect("falls back to the catalog price when Gateway cost is empty and keeps routing", () =>
    Effect.gen(function* () {
      const { session } = yield* seedSession(sessionID)
      yield* session.resume(sessionID)

      const message = assistant(yield* session.messages({ sessionID, order: "asc" }))
      expect(message.cost).toBe(Money.USD.make(0.015))
      expect(message.native?.gateway).toMatchObject({
        cost: "",
        routing: { finalProvider: "vertex" },
        generationId: "gen_empty_cost",
      })
    }),
  )
})
