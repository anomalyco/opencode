import { expect, test } from "bun:test"
import { Cause, Effect, Exit, Schema } from "effect"
import { LLMEvent } from "@opencode-ai/ai"
import { Money } from "@opencode-ai/schema/money"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { Agent } from "@opencode-ai/core/agent"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Session } from "@opencode-ai/core/session"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { RelativePath } from "@opencode-ai/core/schema"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"

const sessionID = Session.ID.make("ses_tool_event_test")
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"

const capture = (providerMetadataKey = "anthropic", options?: { readonly interruptProgress?: boolean }) => {
  const published: Array<{ readonly type: string; readonly data: unknown }> = []
  const bus: Pick<Bus.Interface, "publish"> = {
    publish: (definition, data) => {
      const publish = Effect.sync(() => {
        const event = { id: Event.ID.create(), type: definition.type, data } as Event.Payload<typeof definition>
        published.push({
          type: definition.durable
            ? Bus.versionedType(definition.type, definition.durable.version)
            : definition.type,
          data,
        })
        return event
      })
      return definition.type === SessionEvent.Tool.Progress.type && options?.interruptProgress
        ? publish.pipe(Effect.andThen(Effect.interrupt))
        : publish
    },
  }
  return {
    published,
    publisher: createLLMEventPublisher(bus, {
      sessionID,
      agent: Agent.ID.make("build"),
      model: {
        id: Model.ID.make("model"),
        providerID: Provider.ID.opencode,
      },
      providerMetadataKey,
      assistantMessageID: SessionMessage.ID.create(),
    }),
  }
}

const call = LLMEvent.toolCall({ id: "call-image", name: "read", input: { path: "pixel.png" } })
const hostedResult = LLMEvent.toolResult({
  id: "call-image",
  name: "read",
  result: {
    type: "content",
    value: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
    ],
  },
})

test("local tool success serializes media base64 once through canonical content", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(
    publisher.toolExecution(call.id, call.name, {
      output: { type: "media", mime: "image/png" },
      content: [
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png", name: "pixel.png" },
      ],
    }),
  )

  const success = published.find((event) => event.type === "session.tool.success.2")
  expect(success).toBeDefined()
  const serialized = JSON.stringify(success)
  expect(serialized.split(base64)).toHaveLength(2)
  expect(success?.data).not.toHaveProperty("result")
  expect(success?.data).not.toHaveProperty("output")

  expect(success?.data).toMatchObject({
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" },
    ],
  })
})

test("provider-executed success derives content and retains provider result state", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.toolCall({ ...call, providerExecuted: true })))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.toolResult({
        ...hostedResult,
        providerExecuted: true,
        providerMetadata: { anthropic: { result: { type: "content", value: [] } } },
      }),
    ),
  )
  const success = published.find((event) => event.type === "session.tool.success.2")
  expect(success?.data).not.toHaveProperty("result")
  expect(success?.data).toMatchObject({
    executed: true,
    content: [
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" },
    ],
    resultState: { result: { type: "content" } },
  })
})

test("interrupted progress metadata remains in the terminal failure snapshot", async () => {
  const { published, publisher } = capture("anthropic", { interruptProgress: true })
  await Effect.runPromise(publisher.publish(call))
  const exit = await Effect.runPromiseExit(publisher.progress(call.id, { phase: "visible" }))
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  await Effect.runPromise(publisher.failUnsettledTools({ type: "aborted", message: "interrupted" }))

  expect(published.find((event) => event.type === "session.tool.failed.2")?.data).toMatchObject({
    metadata: { phase: "visible" },
  })
})

test("failure snapshot retains canonical progress above the default byte limit", async () => {
  const { published, publisher } = capture("anthropic", { interruptProgress: true })
  await Effect.runPromise(publisher.publish(call))
  const detail = "x".repeat(60 * 1024)
  await Effect.runPromiseExit(publisher.progress(call.id, { detail }))
  await Effect.runPromise(publisher.failUnsettledTools({ type: "aborted", message: "interrupted" }))

  expect(published.find((event) => event.type === "session.tool.failed.2")?.data).toMatchObject({
    metadata: { detail },
  })
})

test("failure before progress omits partial output fields", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(publisher.failUnsettledTools({ type: "aborted", message: "interrupted" }))

  const failed = published.find((event) => event.type === "session.tool.failed.2")?.data
  expect(failed).not.toHaveProperty("content")
  expect(failed).not.toHaveProperty("metadata")
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
  expect(published.find((event) => event.type === "session.tool.success.2")?.data).toMatchObject({
    resultState: { itemId: "result" },
  })
})

test("binary failure emits no success event", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(
    publisher.failTool(call.id, { type: "tool.execution", message: "Cannot read binary file" }),
  )
  expect(published.some((event) => event.type === "session.tool.success.2")).toBe(false)
  expect(published.some((event) => event.type === "session.tool.failed.2")).toBe(true)
})

test("success event data can carry provider-executed result state", () => {
  const decoded = Schema.decodeUnknownSync(SessionEvent.Tool.Success.data)({
    sessionID,
    assistantMessageID: SessionMessage.ID.create(),
    id: "call-old",
    content: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }],
    executed: true,
    resultState: {
      result: {
        type: "content",
        value: [{ type: "file", uri: `data:image/png;base64,${base64}`, mime: "image/png" }],
      },
    },
  })
  expect(decoded.resultState).toMatchObject({ result: { type: "content" } })
})

test("step finish records settlement without publishing step ended", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(publisher.publish(LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } })))

  expect(published.some((event) => event.type === "step.ended.2")).toBe(false)
  expect(publisher.record().finish).toMatchObject({ finish: "stop" })
})

test("content-filter finish retains failure evidence until step closeout", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "content-filter" },
        usage: {
          nonCachedInputTokens: 8,
          outputTokens: 3,
          reasoningTokens: 1,
        },
      }),
    ),
  )

  expect(published.map((event) => event.type)).toEqual(["session.step.started.1"])
  const settlement = publisher.record().finish
  expect(settlement).toMatchObject({
    finish: "content-filter",
    tokens: { input: 8, output: 2, reasoning: 1 },
  })
  if (!settlement) throw new Error("Expected content-filter settlement")
  await Effect.runPromise(
    publisher.publishStepFailure({
      cost: Money.USD.make(1.25),
      tokens: settlement.tokens,
      snapshot: Snapshot.ID.make("tree-end"),
      files: [RelativePath.make("src/changed.ts")],
    }),
  )
  expect(published.map((event) => event.type)).toEqual(["session.step.started.1", "session.step.failed.1"])
  expect(published.at(-1)?.data).toMatchObject({
    error: { type: "provider.content-filter", message: "Provider blocked the response" },
    cost: 1.25,
    tokens: { input: 8, output: 2, reasoning: 1 },
    snapshot: "tree-end",
    files: ["src/changed.ts"],
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
        LLMEvent.stepFinish({ index: 0, reason: { normalized: "content-filter" } }),
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
