import { expect, test } from "bun:test"
import { LLM, LLMEvent, Message, Model, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { DateTime, Effect, Stream } from "effect"

const compactModel = Model.make({
  id: "compact",
  provider: "fake",
  route: OpenAIChat.route.with({ limits: { context: 20_000, output: 1_000 } }),
})

function eventRecorder(published: string[]): EventV2.Interface {
  return EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push(definition.type)
        return { id: EventV2.ID.create(), type: definition.type, data }
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    aggregateEvents: () => Stream.empty,
    sync: () => Effect.succeed(Effect.void),
    listen: () => Effect.succeed(Effect.void),
    beforeCommit: () => Effect.void,
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
}

function overflowInput(request: LLMRequest) {
  return {
    sessionID: SessionSchema.ID.create(),
    model: compactModel,
    request,
    entries: [
      {
        seq: 1,
        message: new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Earlier question ".repeat(700),
          time: { created: DateTime.makeUnsafe(1) },
        }),
      },
    ],
  }
}

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("provider overflow recovery does not compact when automatic compaction is disabled", async () => {
  const published: string[] = []
  const compaction = SessionCompaction.make({
    events: eventRecorder(published),
    llm: {
      stream: () => Stream.fromIterable([LLMEvent.textDelta({ id: "summary", text: "## Goal\n- Should not compact" })]),
    },
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({ compaction: new ConfigCompaction.Info({ auto: false }) }),
      }),
    ],
  })

  const compacted = await Effect.runPromise(
    compaction.compactAfterOverflow(
      overflowInput(
        LLM.request({
          model: compactModel,
          messages: [Message.user("Continue")],
        }),
      ),
    ),
  )

  expect(compacted).toBe(false)
  expect(published).toEqual([])
})
