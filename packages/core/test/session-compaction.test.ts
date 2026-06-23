import { expect, test } from "bun:test"
import { LLM, Message, Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { Effect, Stream } from "effect"

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

test("overflow compaction returns false when automatic compaction is disabled", async () => {
  const published: string[] = []
  let streamed = false
  const events: EventV2.Interface = {
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push(definition.type)
        return { id: EventV2.ID.make(`evt_${published.length}`), type: definition.type, data }
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
  }
  const model = Model.make({
    id: "compact",
    provider: "fake",
    route: route.with({ limits: { context: 4_000, output: 50 } }),
  })
  const compaction = SessionCompaction.make({
    events,
    llm: {
      stream: () => {
        streamed = true
        return Stream.empty
      },
    },
    config: [
      new Config.Document({
        type: "document",
        info: new Config.Info({
          compaction: new ConfigCompaction.Info({
            auto: false,
            buffer: 3_000,
            keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
          }),
        }),
      }),
    ],
  })

  const compacted = await Effect.runPromise(
    compaction.compactAfterOverflow({
      sessionID: SessionV2.ID.make("ses_compaction_test"),
      entries: [],
      model,
      request: LLM.request({ model, messages: [Message.user("Continue")], tools: [] }),
    }),
  )

  expect(compacted).toBe(false)
  expect(published).toEqual([])
  expect(streamed).toBe(false)
})
