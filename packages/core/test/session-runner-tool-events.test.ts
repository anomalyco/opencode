import { expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { Money } from "@opencode-ai/schema/money"
import { EventV2 } from "@opencode-ai/core/event"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"

const sessionID = SessionV2.ID.make("ses_tool_event_test")
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"

const capture = (providerMetadataKey = "anthropic") => {
  const published: Array<{ readonly type: string; readonly data: unknown }> = []
  const events = EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        const event = { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
        published.push({
          type: definition.durable
            ? EventV2.versionedType(definition.type, definition.durable.version)
            : definition.type,
          data,
        })
        return event
      }),
    subscribe: () => Stream.empty,
    log: () => Stream.empty,
    sequences: () => Effect.succeed(new Map()),
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  })
  return {
    published,
    publisher: createLLMEventPublisher(events, {
      sessionID,
      agent: AgentV2.ID.make("build"),
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.opencode,
      },
      providerMetadataKey,
    }),
  }
}

const call = LLMEvent.toolCall({ id: "call-image", name: "read", input: { path: "pixel.png" } })
const result = LLMEvent.toolResult({
  id: "call-image",
  name: "read",
  result: {
    type: "content",
    value: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
    ],
  },
  output: {
    structured: { type: "media", mime: "image/png" },
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
    ],
  },
})

test("local tool success serializes media base64 once and reconstructs from structured content", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(publisher.publish(result))

  const success = published.find((event) => event.type === "session.tool.success.1")
  expect(success).toBeDefined()
  const serialized = JSON.stringify(success)
  expect(serialized.split(base64)).toHaveLength(2)
  expect(success?.data).not.toHaveProperty("result")

  expect(success?.data).toMatchObject({
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" },
    ],
  })
})

test("provider-executed success retains its raw provider result", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.toolCall({ ...call, providerExecuted: true })))
  await Effect.runPromise(publisher.publish(LLMEvent.toolResult({ ...result, providerExecuted: true })))
  const success = published.find((event) => event.type === "session.tool.success.1")
  expect(success?.data).toHaveProperty("result")
})

test("provider metadata is flattened using the route key", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.reasoningStart({ id: "reasoning", providerMetadata: { anthropic: { signature: "signed" } } }),
    ),
  )

  expect(published.find((event) => event.type === "session.reasoning.started.1")?.data).toMatchObject({
    state: { signature: "signed" },
  })
})

test("reasoning state from start, empty delta, and end is merged", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.reasoningStart({ id: "reasoning", providerMetadata: { anthropic: { blockType: "thinking" } } }),
    ),
  )
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.reasoningDelta({
        id: "reasoning",
        text: "",
        providerMetadata: { anthropic: { signature: "signed" }, gateway: { traceID: "trace" } },
      }),
    ),
  )
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.reasoningEnd({ id: "reasoning", providerMetadata: { anthropic: { stopReason: "tool_use" } } }),
    ),
  )

  expect(published.find((event) => event.type === "session.reasoning.ended.1")?.data).toMatchObject({
    state: { blockType: "thinking", signature: "signed", stopReason: "tool_use" },
  })
})

test("provider-executed tool metadata is flattened using the route key", async () => {
  const { published, publisher } = capture("openai")
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolCall({
        id: "hosted",
        name: "web_search",
        input: { query: "Effect" },
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "call" } },
      }),
    ),
  )
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: "hosted",
        name: "web_search",
        result: { type: "json", value: { found: true } },
        providerExecuted: true,
        providerMetadata: { openai: { itemId: "result" } },
      }),
    ),
  )

  expect(published.find((event) => event.type === "session.tool.called.1")?.data).toMatchObject({
    state: { itemId: "call" },
  })
  expect(published.find((event) => event.type === "session.tool.success.1")?.data).toMatchObject({
    resultState: { itemId: "result" },
  })
})

test("binary failure emits no success event", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        id: call.id,
        name: call.name,
        result: { type: "error", value: "Cannot read binary file" },
      }),
    ),
  )
  expect(published.some((event) => event.type === "session.tool.success.1")).toBe(false)
  expect(published.some((event) => event.type === "session.tool.failed.1")).toBe(true)
})

test("success event data can carry a provider-executed result", () => {
  const decoded = Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)({
    sessionID,
    assistantMessageID: SessionMessage.ID.create(),
    callID: "call-old",
    structured: { type: "media", mime: "image/png" },
    content: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }],
    result: { type: "content", value: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }] },
    executed: true,
  })
  expect(decoded.result).toMatchObject({ type: "content" })
})

test("step finish records settlement without publishing step ended", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(publisher.publish(LLMEvent.stepFinish({ index: 0, reason: "stop" })))

  expect(published.some((event) => event.type === "step.ended.2")).toBe(false)
  expect(publisher.stepSettlement()).toMatchObject({ finish: "stop" })
})

test("content-filter finish retains failure evidence until step closeout", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.stepFinish({
        index: 0,
        reason: "content-filter",
        usage: {
          nonCachedInputTokens: 8,
          outputTokens: 3,
          reasoningTokens: 1,
        },
      }),
    ),
  )

  expect(published.map((event) => event.type)).toEqual(["session.step.started.1"])
  const settlement = publisher.stepSettlement()
  expect(settlement).toMatchObject({
    finish: "content-filter",
    tokens: { input: 8, output: 2, reasoning: 1 },
  })
  if (!settlement) throw new Error("Expected content-filter settlement")
  await Effect.runPromise(
    publisher.publishStepFailure({
      cost: Money.USD.make(1.25),
      tokens: settlement.tokens,
    }),
  )
  expect(published.map((event) => event.type)).toEqual(["session.step.started.1", "session.step.failed.1"])
  expect(published.at(-1)?.data).toMatchObject({
    error: { type: "provider.content-filter", message: "Provider blocked the response" },
    cost: 1.25,
    tokens: { input: 8, output: 2, reasoning: 1 },
  })
})

test("content-filter finish preserves partial streamed text and never ends the step successfully", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(
    Effect.forEach(
      [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text" }),
        LLMEvent.textDelta({ id: "text", text: "Partial" }),
        LLMEvent.stepFinish({ index: 0, reason: "content-filter" }),
      ],
      (event) => publisher.publish(event),
      { discard: true },
    ),
  )
  await Effect.runPromise(publisher.publishStepFailure())

  expect(published.some((event) => event.type === "session.step.ended.1")).toBe(false)
  expect(published.find((event) => event.type === "session.text.ended.1")?.data).toMatchObject({ text: "Partial" })
  expect(published.find((event) => event.type === "session.step.failed.1")?.data).toMatchObject({
    error: { type: "provider.content-filter" },
  })
})
