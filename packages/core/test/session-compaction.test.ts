import { expect, test } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { LLM, LLMEvent, Message, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { DateTime, Effect, Stream } from "effect"

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

test("compaction can trigger from configured request byte envelope", async () => {
  const events: Array<{ readonly type: string; readonly payload: unknown }> = []
  const compact = SessionCompaction.make({
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({
          compaction: new ConfigCompaction.Info({
            keep: new ConfigCompaction.Keep({ tokens: 16 }),
            max_request_bytes: 512,
          }),
        }),
      }),
    ],
    events: {
      publish: (definition, payload) =>
        Effect.sync(() => {
          const event = { id: EventV2.ID.create(), type: definition.type, data: payload } as EventV2.Payload<
            typeof definition
          >
          events.push({ type: definition.type, payload })
          return event
        }),
      subscribe: () => Stream.empty,
      all: () => Stream.empty,
      durable: () => Stream.empty,
      listen: () => Effect.succeed(Effect.void),
      project: () => Effect.void,
      replay: () => Effect.void,
      replayAll: () => Effect.succeed(undefined),
      remove: () => Effect.void,
      claim: () => Effect.void,
    },
    llm: {
      stream: () =>
        Stream.make(
          LLMEvent.textStart({ id: "summary" }),
          LLMEvent.textDelta({ id: "summary", text: "## Objective\n- Keep request small" }),
          LLMEvent.finish({ reason: "stop" }),
        ),
    },
  })
  const sessionID = SessionSchema.ID.make("ses_byte_guard")
  const model = Model.make({
    id: "claude-fable-5",
    provider: "opencode",
    route: route.with({ limits: { context: 1_000_000, output: 4_096 } }),
  })
  const message: SessionMessage.Message = {
    id: SessionMessage.ID.create(),
    type: "user",
    text: "Important historical context ".repeat(80),
    files: [],
    agents: [],
    time: { created: DateTime.makeUnsafe(Date.now()) },
  }

  const result = await Effect.runPromise(
    compact.compactIfNeeded({
      sessionID,
      entries: [{ seq: 1, message }],
      model,
      request: LLM.request({
        model,
        messages: [Message.user("x".repeat(1_500))],
        tools: [],
      }),
    }),
  )

  expect(result).toBe(true)
  expect(events).toHaveLength(2)
  expect(events.map((event) => (event.payload as { readonly reason?: string }).reason)).toEqual(["auto", "auto"])
})
