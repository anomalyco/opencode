import { expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { eq } from "drizzle-orm"
import { LLMEvent } from "@opencode-ai/ai"
import { Money } from "@opencode-ai/schema/money"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Event } from "@opencode-ai/schema/event"
import { Agent } from "@opencode-ai/core/agent"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Session } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { it, testEffect } from "./lib/effect"
import { TestClock } from "effect/testing"

const sessionID = Session.ID.make("ses_tool_event_test")
const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"

const capture = (providerMetadataKey = "anthropic", options?: { readonly interruptProgress?: boolean }) => {
  const published: Array<{ readonly type: string; readonly data: unknown }> = []
  const bus: Pick<Bus.Interface, "publish"> = {
    publish: (definition, data) => {
      const publish = Effect.sync(() => {
        const event = { id: Event.ID.create(), type: definition.type, data } as Event.Payload<typeof definition>
        published.push({
          type: definition.durable ? Bus.versionedType(definition.type, definition.durable.version) : definition.type,
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

testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
    [Bus.node, Bus.configured({ persist: true })],
  ]),
).effect("commits a hosted tool result when cancellation races with the aggregate lock", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const held = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const queued = yield* Deferred.make<void>()
    const assistantMessageID = SessionMessage.ID.create()
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* database.db
      .insert(SessionTable)
      .values({ id: sessionID, project_id: Project.ID.global, slug: "publish", directory: "/project", version: "test" })
      .run()
    const publisher = createLLMEventPublisher(
      {
        publish: (definition, data, options) =>
          (definition.type === SessionEvent.Tool.Success.type ? Deferred.succeed(queued, undefined) : Effect.void).pipe(
            Effect.andThen(bus.publish(definition, data, options)),
          ),
      },
      {
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        model: { id: Model.ID.make("test-model"), providerID: Provider.ID.opencode },
        providerMetadataKey: "openai",
      },
    )
    yield* publisher.publish(LLMEvent.toolCall({ ...call, providerExecuted: true }))
    yield* Effect.acquireRelease(
      bus.listen((event) =>
        event.type === SessionEvent.Renamed.type
          ? Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      ),
      (unsubscribe) => unsubscribe,
    )
    // Listener delivery holds the aggregate lock after this unrelated event commits.
    const holder = yield* bus
      .publish(SessionEvent.Renamed, { sessionID, title: "Hold publication" })
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(held)
    const publication = yield* publisher
      .publish(LLMEvent.toolResult({ ...hostedResult, providerExecuted: true }))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    yield* Deferred.await(queued)
    const cancellation = yield* Fiber.interrupt(publication).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Effect.yieldNow

    expect(cancellation.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(holder)
    yield* Fiber.join(cancellation)
    expect(Exit.hasInterrupts(yield* Fiber.await(publication))).toBe(true)
    expect(yield* publisher.failUnsettledTools({ type: "aborted", message: "Interrupted" })).toBe(false)

    const events = yield* database.db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .all()
    expect(events.filter((event) => event.type === "session.tool.success.2")).toHaveLength(1)
    expect(events.some((event) => event.type === "session.tool.failed.2")).toBe(false)
    const message = yield* database.db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .get()
    expect(message?.data).toMatchObject({
      content: [{ type: "tool", id: call.id, executed: true, state: { status: "completed" } }],
    })
  }),
)

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

test("interrupted subagent failures expose their existing child session to the model", async () => {
  const { published, publisher } = capture("anthropic", { interruptProgress: true })
  const subagent = LLMEvent.toolCall({
    id: "call-subagent",
    name: "subagent",
    input: { agent: "general", description: "Recover child", prompt: "Continue working" },
  })
  await Effect.runPromise(publisher.publish(subagent))
  await Effect.runPromiseExit(publisher.progress(subagent.id, { sessionID: "ses_existing_child", status: "running" }))
  await Effect.runPromise(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))

  expect(published.find((event) => event.type === "session.tool.failed.2")?.data).toMatchObject({
    error: { type: "aborted", message: "Tool execution interrupted (sessionID: ses_existing_child)" },
    metadata: { sessionID: "ses_existing_child", status: "running" },
  })
})

test("interrupted non-subagent failures do not expose their progress session IDs", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(publisher.progress(call.id, { sessionID: "ses_private", status: "running" }))
  await Effect.runPromise(publisher.failUnsettledTools({ type: "aborted", message: "Tool execution interrupted" }))

  expect(published.find((event) => event.type === "session.tool.failed.2")?.data).toMatchObject({
    error: { type: "aborted", message: "Tool execution interrupted" },
    metadata: { sessionID: "ses_private", status: "running" },
  })
})

test("local failure metadata completes the progress snapshot", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(call))
  await Effect.runPromise(publisher.progress(call.id, { phase: "running", provider: "old" }))
  await Effect.runPromise(
    publisher.failTool(call.id, { type: "tool.execution", message: "failed" }, { provider: "exa" }),
  )

  expect(published.find((event) => event.type === "session.tool.failed.2")?.data).toMatchObject({
    metadata: { phase: "running", provider: "exa" },
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

it.effect("batches text deltas and flushes pending text before the terminal event", () =>
  Effect.gen(function* () {
    const { published, publisher } = capture()
    yield* Effect.forEach(
      [
        LLMEvent.textStart({ id: "text" }),
        LLMEvent.textDelta({ id: "text", text: "one" }),
        LLMEvent.textDelta({ id: "text", text: " two" }),
        LLMEvent.textDelta({ id: "text", text: " three" }),
      ],
      publisher.publish,
      { discard: true },
    )

    expect(published.filter((event) => event.type === "session.text.delta")).toHaveLength(0)
    yield* TestClock.adjust("99 millis")
    expect(published.filter((event) => event.type === "session.text.delta")).toHaveLength(0)
    yield* TestClock.adjust("1 millis")
    yield* publisher.publish(LLMEvent.textDelta({ id: "text", text: " four" }))
    expect(published.filter((event) => event.type === "session.text.delta").map((event) => event.data)).toMatchObject([
      { delta: "one two three four" },
    ])

    yield* publisher.publish(LLMEvent.textDelta({ id: "text", text: " five" }))
    yield* publisher.publish(LLMEvent.textEnd({ id: "text" }))
    expect(published.slice(-2).map((event) => event.type)).toEqual(["session.text.delta", "session.text.ended.1"])
    expect(published.at(-2)?.data).toMatchObject({ delta: " five" })
  }),
)

it.effect("batches reasoning deltas and flushes pending reasoning before the terminal event", () =>
  Effect.gen(function* () {
    const { published, publisher } = capture()
    yield* Effect.forEach(
      [
        LLMEvent.reasoningStart({ id: "reasoning" }),
        LLMEvent.reasoningDelta({ id: "reasoning", text: "one" }),
        LLMEvent.reasoningDelta({ id: "reasoning", text: " two" }),
        LLMEvent.reasoningDelta({ id: "reasoning", text: " three" }),
        LLMEvent.reasoningEnd({ id: "reasoning" }),
      ],
      publisher.publish,
      { discard: true },
    )

    expect(
      published.filter((event) => event.type === "session.reasoning.delta").map((event) => event.data),
    ).toMatchObject([{ delta: "one two three" }])
    expect(published.slice(-2).map((event) => event.type)).toEqual([
      "session.reasoning.delta",
      "session.reasoning.ended.1",
    ])
  }),
)

test("authoritative end values replace accumulated deltas in the durable ended events", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(
    Effect.forEach(
      [
        LLMEvent.textStart({ id: "text" }),
        LLMEvent.textDelta({ id: "text", text: "Hel" }),
        LLMEvent.textEnd({ id: "text", text: "Hello!" }),
        LLMEvent.reasoningStart({ id: "reasoning" }),
        LLMEvent.reasoningDelta({ id: "reasoning", text: "Thin" }),
        LLMEvent.reasoningEnd({ id: "reasoning", text: "Thinking done." }),
      ],
      publisher.publish,
      { discard: true },
    ),
  )

  expect(published.find((event) => event.type === "session.text.ended.1")?.data).toMatchObject({ text: "Hello!" })
  expect(published.find((event) => event.type === "session.reasoning.ended.1")?.data).toMatchObject({
    text: "Thinking done.",
  })
})

test("tool input deltas are accumulated without being published", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(
    Effect.forEach(
      [
        LLMEvent.toolInputStart({ id: "call", name: "read" }),
        LLMEvent.toolInputDelta({ id: "call", name: "read", text: '{"path":' }),
        LLMEvent.toolInputDelta({ id: "call", name: "read", text: '"file.txt"}' }),
        LLMEvent.toolInputEnd({ id: "call", name: "read" }),
      ],
      publisher.publish,
      { discard: true },
    ),
  )

  expect(published.some((event) => event.type === "session.tool.input.delta")).toBe(false)
  expect(published.find((event) => event.type === "session.tool.input.ended.1")?.data).toMatchObject({
    text: '{"path":"file.txt"}',
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
  await Effect.runPromise(publisher.failTool(call.id, { type: "tool.execution", message: "Cannot read binary file" }))
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

  expect(published.map((event) => event.type)).toEqual(["session.step.started.1"])
  expect(publisher.record().finish).toMatchObject({ finish: "stop" })
})

test("content-filter finish retains failure evidence until step closeout", async () => {
  const { published, publisher } = capture()
  await Effect.runPromise(publisher.publish(LLMEvent.stepStart({ index: 0 })))
  await Effect.runPromise(
    publisher.publish(
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "content-filter", raw: "refusal" },
        providerMetadata: {
          anthropic: {
            stopDetails: { type: "refusal", category: "safety", explanation: "Blocked" },
          },
        },
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
    rawFinish: "refusal",
    providerState: {
      stopDetails: { type: "refusal", category: "safety", explanation: "Blocked" },
    },
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
    finish: "content-filter",
    rawFinish: "refusal",
    providerState: {
      stopDetails: { type: "refusal", category: "safety", explanation: "Blocked" },
    },
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
