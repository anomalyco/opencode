import { describe, expect } from "bun:test"
import { LanguageModel, LLMClient, LLMEvent } from "@Mackery6969/ai/effect"
import { OpenAIChat } from "@Mackery6969/ai/protocols"
import { Bus } from "@Mackery6969/core/bus"
import { Config } from "@Mackery6969/core/config"
import { ConfigCompactionPlugin } from "@Mackery6969/core/config/plugin/compaction"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { llmClient } from "@Mackery6969/core/effect/app-node-platform"
import { SessionCompaction } from "@Mackery6969/core/session/compaction"
import { SessionEvent } from "@Mackery6969/core/session/event"
import { SessionMessage } from "@Mackery6969/core/session/message"
import { SessionModelRequest } from "@Mackery6969/core/session/model-request"
import { SessionRunnerModel } from "@Mackery6969/core/session/runner/model"
import { Session } from "@Mackery6969/core/session"
import { Agent } from "@Mackery6969/core/agent"
import { Location } from "@Mackery6969/core/location"
import { Project } from "@Mackery6969/core/project"
import { AbsolutePath } from "@Mackery6969/core/schema"
import { ConfigCompaction } from "@Mackery6969/schema/config/compaction"
import { Document, Event, Info } from "@Mackery6969/schema/config"
import { Money } from "@Mackery6969/schema/money"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { DateTime, Effect, Fiber, Layer, Option, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const model = LanguageModel.make({
  id: "test-model",
  provider: "test-provider",
  route: OpenAIChat.route,
})
const limit = { context: 100_000, output: 1_000 }
const resolved = SessionRunnerModel.resolved(model, {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit,
})
const config = Config.testLayer()
const it = testEffect(
  Layer.merge(
    config,
    AppNodeBuilder.build(LayerNode.group([SessionCompaction.node, SessionModelRequest.node, Config.node, Bus.node]), [
      llmClient.replace(
        Layer.mock(LLMClient.Service)({
          stream: () => Stream.make(LLMEvent.textDelta({ id: "summary", text: "## Objective\n- summary" })),
        }),
      ),
      Config.node.replace(config),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/tmp") })),
    ]),
  ),
)
describe("ConfigCompactionPlugin.Plugin", () => {
  it.live("merges settings and reloads changed config", () =>
    Effect.gen(function* () {
      const compaction = yield* SessionCompaction.Service
      // An automatic compaction that is not due is skipped.
      const due = (input: typeof nearInput) =>
        compaction
          .compact({ reason: "auto", context: input.context })
          .pipe(Effect.map((outcome) => outcome.status !== "skipped"))
      const config = yield* Config.Test
      const bus = yield* Bus.Service
      yield* config.setEntries([
        new Document({
          type: "document",
          info: new Info({ compaction: new ConfigCompaction.Info({ auto: false, buffer: 20_000 }) }),
        }),
        new Document({
          type: "document",
          info: new Info({
            compaction: new ConfigCompaction.Info({
              buffer: 10_000,
              keep: new ConfigCompaction.Keep({ tokens: 0 }),
            }),
          }),
        }),
      ])
      yield* ConfigCompactionPlugin.Plugin.effect(host({ event: { subscribe: () => bus.subscribe(Event.Updated) } }))

      expect(yield* due(nearInput)).toBe(false)
      const ended = yield* bus
        .subscribe(SessionEvent.Compaction.Ended)
        .pipe(Stream.runHead, Effect.forkScoped({ startImmediately: true }))
      const messages = [
        SessionMessage.User.make({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Older context",
          time: { created: DateTime.makeUnsafe(0) },
        }),
        SessionMessage.User.make({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Recent context",
          time: { created: DateTime.makeUnsafe(1) },
        }),
      ]
      expect(
        yield* compaction.compact({
          reason: "manual",
          context: { ...nearInput.context, messages },
          inputID: SessionMessage.ID.make("msg_compaction_manual"),
        }),
      ).toEqual({ status: "completed" })
      expect(Option.getOrThrow(yield* Fiber.join(ended)).metadata?.keepID).toBe(messages[1].id)

      yield* config.setEntries([
        new Document({
          type: "document",
          info: new Info({ compaction: new ConfigCompaction.Info({ auto: true, buffer: 20_000 }) }),
        }),
        new Document({
          type: "document",
          info: new Info({ compaction: new ConfigCompaction.Info({ buffer: 10_000 }) }),
        }),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* Effect.gen(function* () {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (yield* due(nearInput)) return
          yield* Effect.sleep("10 millis")
        }
        yield* Effect.die(new Error("Timed out waiting for compaction config reload"))
      })
      expect(yield* due(bufferedInput)).toBe(false)

      yield* config.setEntries([
        new Document({
          type: "document",
          info: new Info({ compaction: new ConfigCompaction.Info({ auto: true, buffer: 20_000 }) }),
        }),
      ])
      yield* bus.publish(Event.Updated, {})
      for (let attempt = 0; attempt < 200; attempt++) {
        if (yield* due(bufferedInput)) return
        yield* Effect.sleep("10 millis")
      }
      yield* Effect.die(new Error("Timed out waiting for compaction config reload"))
    }),
  )
})

const session = Session.Info.make({
  id: Session.ID.make("ses_compaction_config"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/tmp") }),
})
const input = (tokens: number) => {
  const messages = [
    Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: SessionMessage.ID.make("msg_compaction_config"),
      type: "assistant",
      agent: Agent.defaultID,
      model: { id: "test-model", providerID: "test-provider" },
      content: [],
      tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, completed: 0 },
    }),
  ]
  return {
    session,
    resolved,
    messages,
    context: {
      session,
      model: resolved,
      messages,
      agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
      initial: [],
      tools: { definitions: [], execute: () => Effect.die("unused") },
    },
  }
}
const bufferedInput = input(85_000)
const nearInput = input(95_000)
