import { describe, expect } from "bun:test"
import { LLMClient, LLMError, LLMEvent, Model, Tool, TransportReason, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const projector = SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))
const store = SessionStore.layer.pipe(Layer.provide(database))
const requests: LLMRequest[] = []
let response: LLMEvent[] = []
let responses: LLMEvent[][] | undefined
let responseStream: Stream.Stream<LLMEvent, LLMError> | undefined
let streamGate: Deferred.Deferred<void> | undefined
let streamStarted: Deferred.Deferred<void> | undefined
let streamFailure: LLMError | undefined
let toolExecutionGate: Deferred.Deferred<void> | undefined
let toolExecutionsStarted: Deferred.Deferred<void> | undefined
let activeToolExecutions = 0
let maxActiveToolExecutions = 0
const client = Layer.succeed(LLMClient.Service, LLMClient.Service.of({
  prepare: () => Effect.die("unused"),
  stream: ((request: LLMRequest) => {
    requests.push(request)
    if (responseStream) {
      const stream = responseStream
      responseStream = undefined
      return stream
    }
    const events = streamFailure
      ? Stream.fail(streamFailure)
      : Stream.fromIterable(responses === undefined ? response : (responses.shift() ?? []))
    if (!streamGate) return events
    return Stream.unwrap(
      (streamStarted ? Deferred.succeed(streamStarted, undefined) : Effect.void).pipe(
        Effect.andThen(Deferred.await(streamGate)),
        Effect.as(events),
      ),
    )
  }) as unknown as LLMClientShape["stream"],
  generate: () => Effect.die("unused"),
}))
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const authorizations: ToolRegistry.AuthorizeInput[] = []
const executions: string[] = []
const registry = ToolRegistry.layer
const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.contribute((editor) => {
      editor.set("echo", {
        authorize: (input) => Effect.sync(() => {
          authorizations.push(input)
        }),
        tool: Tool.make({
          description: "Echo text",
          parameters: Schema.Struct({ text: Schema.String }),
          success: Schema.Struct({ text: Schema.String }),
          execute: ({ text }) =>
            Effect.gen(function* () {
              executions.push(text)
              activeToolExecutions++
              maxActiveToolExecutions = Math.max(maxActiveToolExecutions, activeToolExecutions)
              if (activeToolExecutions === 5 && toolExecutionsStarted) {
                yield* Deferred.succeed(toolExecutionsStarted, undefined)
              }
              if (toolExecutionGate) yield* Deferred.await(toolExecutionGate)
              return { text }
            }).pipe(Effect.ensuring(Effect.sync(() => activeToolExecutions--))),
        }),
      }),
      editor.set("defect", {
        tool: Tool.make({
          description: "Fail unexpectedly",
          parameters: Schema.Struct({}),
          success: Schema.Struct({}),
          execute: () => Effect.die("unexpected tool defect"),
        }),
      })
    }),
  ),
).pipe(Layer.provide(registry))
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const runner = SessionRunnerLLM.layer.pipe(
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(events),
  Layer.provide(client),
  Layer.provide(registry),
  Layer.provide(models),
)
const execution = Layer.effect(
  SessionExecution.Service,
  SessionRunner.Service.pipe(Effect.map((runner) => SessionExecution.Service.of({ resume: runner.run }))),
).pipe(Layer.provide(runner))
const sessions = SessionV2.layer.pipe(
  Layer.provide(events),
  Layer.provide(database),
  Layer.provide(store),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(Layer.mergeAll(database, events, projector, store, client, registry, echo, models, runner, execution, sessions))
const sessionID = SessionV2.ID.make("ses_runner_test")
const otherSessionID = SessionV2.ID.make("ses_runner_other")

const insertSession = (id: SessionV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: "test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  streamFailure = undefined
  responseStream = undefined
  toolExecutionGate = undefined
  toolExecutionsStarted = undefined
  activeToolExecutions = 0
  maxActiveToolExecutions = 0
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* insertSession(sessionID)
})

describe("SessionRunnerLLM", () => {
  it.effect("starts a real runner turn after default prompt recording", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      requests.length = 0
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = []

      const message = yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run automatically" }) })

      expect(requests).toHaveLength(1)
      expect(yield* session.messages({ sessionID })).toEqual([message])
    }),
  )

  it.effect("streams one request with registry definitions from chronological V2 user history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "First" }), resume: false })
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Second" }), resume: false })

      requests.length = 0
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = []
      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.model).toBe(model)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "defect"])
      expect(requests[0]?.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
        { role: "user", content: [{ type: "text", text: "First" }] },
        { role: "user", content: [{ type: "text", text: "Second" }] },
      ])
      expect(yield* session.messages({ sessionID })).toHaveLength(2)
    }),
  )

  it.effect("projects reasoning and tool events without executing or continuing tools", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Use tools" }), resume: false })

      requests.length = 0
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
        LLMEvent.reasoningDelta({ id: "reasoning-1", text: "Think" }),
        LLMEvent.reasoningEnd({ id: "reasoning-1" }),
        LLMEvent.toolInputStart({ id: "call-error", name: "write" }),
        LLMEvent.toolInputDelta({ id: "call-error", name: "write", text: '{"path":"README.md"}' }),
        LLMEvent.toolInputEnd({ id: "call-error", name: "write" }),
        LLMEvent.toolCall({ id: "call-error", name: "write", input: { path: "README.md" }, providerExecuted: true }),
        LLMEvent.toolError({ id: "call-error", name: "write", message: "Denied" }),
        LLMEvent.toolResult({ id: "call-error", name: "write", result: { type: "error", value: "Denied" } }),
        LLMEvent.toolCall({
          id: "call-provider",
          name: "web_search",
          input: { query: "hello" },
          providerExecuted: true,
          providerMetadata: { fake: { source: "provider" } },
        }),
        LLMEvent.toolResult({
          id: "call-provider",
          name: "web_search",
          result: {
            type: "content",
            value: [
              { type: "text", text: "Hello" },
              { type: "media", mediaType: "image/png", data: "data:image/png;base64,aGVsbG8=", filename: "hello.png" },
            ],
          },
          providerExecuted: true,
          providerMetadata: { fake: { source: "provider" } },
        }),
        LLMEvent.stepFinish({
          index: 0,
          reason: "tool-calls",
          usage: { inputTokens: 10, nonCachedInputTokens: 8, outputTokens: 4, reasoningTokens: 1, cacheReadInputTokens: 2 },
        }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "defect"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Use tools" },
        {
          type: "assistant",
          finish: "tool-calls",
          tokens: { input: 8, output: 3, reasoning: 1, cache: { read: 2, write: 0 } },
          content: [
            { type: "reasoning", id: "reasoning-1", text: "Think" },
            {
              type: "tool",
              id: "call-error",
              name: "write",
              state: {
                status: "error",
                input: { path: "README.md" },
                error: { type: "unknown", message: "Denied" },
              },
            },
            {
              type: "tool",
              id: "call-provider",
              name: "web_search",
              provider: { executed: true, metadata: { fake: { source: "provider" } } },
              state: {
                status: "completed",
                input: { query: "hello" },
                structured: {},
                content: [
                  { type: "text", text: "Hello" },
                  { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=", name: "hello.png" },
                ],
              },
            },
          ],
        },
      ])

    }),
  )

  it.effect("continues with reloaded history after durably settling one local tool call", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Echo this" }), resume: false })

      requests.length = 0
      authorizations.length = 0
      executions.length = 0
      streamGate = undefined
      streamStarted = undefined
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-echo", name: "echo", input: { text: "hello" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-final" }),
          LLMEvent.textDelta({ id: "text-final", text: "Done" }),
          LLMEvent.textEnd({ id: "text-final" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(requests[1]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
      expect(authorizations).toMatchObject([{ sessionID, call: { id: "call-echo", name: "echo" } }])
      expect(executions).toEqual(["hello"])
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo this" },
        {
          type: "assistant",
          finish: "tool-calls",
          content: [
            {
              type: "tool",
              id: "call-echo",
              name: "echo",
              state: { status: "completed", input: { text: "hello" }, structured: { text: "hello" }, content: [] },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", id: "text-final", text: "Done" }] },
      ])
    }),
  )

  it.effect("starts recorded local tools eagerly and awaits settlement before continuing", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Echo five times" }), resume: false })

      requests.length = 0
      executions.length = 0
      toolExecutionGate = yield* Deferred.make<void>()
      toolExecutionsStarted = yield* Deferred.make<void>()
      const providerGate = yield* Deferred.make<void>()
      response = []
      responses = undefined
      const initial = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        ...Array.from({ length: 5 }, (_, index) =>
          LLMEvent.toolCall({ id: `call-echo-${index}`, name: "echo", input: { text: `${index}` } }),
        ),
      ])
      const final = Stream.fromIterable([
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ])
      streamGate = undefined
      responseStream = Stream.concat(
        initial,
        Stream.fromEffect(Deferred.await(providerGate)).pipe(Stream.flatMap(() => final)),
      )

      const run = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(toolExecutionsStarted)

      expect(executions).toHaveLength(5)
      expect(maxActiveToolExecutions).toBe(5)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo five times" },
        {
          type: "assistant",
          content: Array.from({ length: 5 }, (_, index) => ({
            type: "tool",
            id: `call-echo-${index}`,
            state: { status: "running", input: { text: `${index}` } },
          })),
        },
      ])

      yield* Deferred.succeed(providerGate, undefined)
      yield* Effect.yieldNow
      expect(requests).toHaveLength(1)

      yield* Deferred.succeed(toolExecutionGate, undefined)
      yield* Fiber.join(run)
      toolExecutionGate = undefined
      toolExecutionsStarted = undefined

      expect(executions).toHaveLength(5)
      expect(maxActiveToolExecutions).toBe(5)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("settles repeated provider-local tool call IDs against their owning assistant messages", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Echo twice" }), resume: false })

      requests.length = 0
      executions.length = 0
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "tool_0", name: "echo", input: { text: "first" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "tool_0", name: "echo", input: { text: "second" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [],
      ]

      yield* session.resume(sessionID)

      expect(executions).toEqual(["first", "second"])
      expect(requests).toHaveLength(3)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo twice" },
        {
          type: "assistant",
          content: [{ type: "tool", id: "tool_0", state: { status: "completed", structured: { text: "first" } } }],
        },
        {
          type: "assistant",
          content: [{ type: "tool", id: "tool_0", state: { status: "completed", structured: { text: "second" } } }],
        },
      ])

      const { db } = yield* Database.Service
      const event = yield* EventV2.Service
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* event.remove(sessionID)
      yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* event.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Echo twice" },
        {
          type: "assistant",
          content: [{ type: "tool", id: "tool_0", state: { status: "completed", structured: { text: "first" } } }],
        },
        {
          type: "assistant",
          content: [{ type: "tool", id: "tool_0", state: { status: "completed", structured: { text: "second" } } }],
        },
      ])
    }),
  )

  it.effect("joins concurrent resume calls into one active provider run", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run once" }), resume: false })

      requests.length = 0
      responses = undefined
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-once" }),
        LLMEvent.textDelta({ id: "text-once", text: "Once" }),
        LLMEvent.textEnd({ id: "text-once" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      streamGate = undefined
      streamStarted = undefined

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Run once" },
        { type: "assistant", finish: "stop", content: [{ type: "text", id: "text-once", text: "Once" }] },
      ])
    }),
  )

  it.effect("runs different sessions concurrently", () =>
    Effect.gen(function* () {
      yield* setup
      yield* insertSession(otherSessionID)
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Run first" }), resume: false })
      yield* session.prompt({ sessionID: otherSessionID, prompt: new Prompt({ text: "Run second" }), resume: false })

      requests.length = 0
      responses = undefined
      response = []
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      const second = yield* session.resume(otherSessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(2)
      yield* Deferred.succeed(streamGate, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      streamGate = undefined
      streamStarted = undefined
    }),
  )

  it.effect("fans out one failed run and allows a later retry", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Retry after failure" }), resume: false })

      requests.length = 0
      responses = undefined
      response = []
      streamFailure = new LLMError({
        module: "test",
        method: "stream",
        reason: new TransportReason({ message: "Provider unavailable" }),
      })
      streamGate = yield* Deferred.make<void>()
      streamStarted = yield* Deferred.make<void>()

      const first = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamStarted)
      const second = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow

      expect(requests).toHaveLength(1)
      yield* Deferred.succeed(streamGate, undefined)
      const [firstExit, secondExit] = yield* Effect.all([Fiber.await(first), Fiber.await(second)])
      expect(secondExit).toEqual(firstExit)

      streamFailure = undefined
      streamGate = undefined
      streamStarted = undefined
      yield* session.resume(sessionID)
      expect(requests).toHaveLength(2)
    }),
  )

  it.effect("durably settles local tool failures before continuing", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Call missing" }), resume: false })

      requests.length = 0
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-missing", name: "missing", input: {} }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-after-error" }),
          LLMEvent.textDelta({ id: "text-after-error", text: "Recovered" }),
          LLMEvent.textEnd({ id: "text-after-error" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]
      streamGate = undefined
      streamStarted = undefined

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call missing" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-missing",
              state: { status: "error", error: { message: "Unknown tool: missing" } },
            },
          ],
        },
        { type: "assistant", finish: "stop", content: [{ type: "text", id: "text-after-error", text: "Recovered" }] },
      ])
    }),
  )

  it.effect("durably settles unexpected local tool defects before continuing", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Call defect" }), resume: false })

      requests.length = 0
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-defect", name: "defect", input: {} }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [],
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Call defect" },
        {
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call-defect",
              state: { status: "error", error: { message: "unexpected tool defect" } },
            },
          ],
        },
      ])
    }),
  )

  it.effect("fails after the bounded number of local tool continuation steps", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Loop forever" }), resume: false })

      requests.length = 0
      authorizations.length = 0
      executions.length = 0
      streamGate = undefined
      streamStarted = undefined
      responses = Array.from({ length: 25 }, (_, index) => [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: `call-echo-${index}`, name: "echo", input: { text: `${index}` } }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
        LLMEvent.finish({ reason: "tool-calls" }),
      ])

      const failure = yield* session.resume(sessionID).pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "SessionRunner.StepLimitExceededError", sessionID, limit: 25 })
      expect(requests).toHaveLength(25)
      expect(executions).toHaveLength(25)
    }),
  )

  it.effect("projects provider errors as terminal assistant step failures", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Fail durably" }), resume: false })

      requests.length = 0
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [LLMEvent.stepStart({ index: 0 }), LLMEvent.providerError({ message: "Provider unavailable" })]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(1)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail durably" },
        { type: "assistant", finish: "error", error: { type: "unknown", message: "Provider unavailable" } },
      ])
    }),
  )

  it.effect("keeps interleaved assistant text blocks separate", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Two blocks" }), resume: false })

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-1" }),
        LLMEvent.textStart({ id: "text-2" }),
        LLMEvent.textDelta({ id: "text-1", text: "First" }),
        LLMEvent.textDelta({ id: "text-2", text: "Second" }),
        LLMEvent.textEnd({ id: "text-1" }),
        LLMEvent.textEnd({ id: "text-2" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Two blocks" },
        {
          type: "assistant",
          content: [
            { type: "text", id: "text-1", text: "First" },
            { type: "text", id: "text-2", text: "Second" },
          ],
        },
      ])
    }),
  )

  it.effect("broadcasts provider text deltas without storing projection rewrites", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Stream many chunks" }), resume: false })
      const live: SessionEvent.Text.Delta[] = []
      const unsubscribe = yield* EventV2.Service.pipe(
        Effect.flatMap((events) => events.listen((event) => Effect.sync(() => {
          if (event.type === SessionEvent.Text.Delta.type) live.push(event as SessionEvent.Text.Delta)
        }))),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-many" }),
        ...Array.from({ length: 32 }, (_, index) => LLMEvent.textDelta({ id: "text-many", text: `${index},` })),
        LLMEvent.textEnd({ id: "text-many" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const deltas = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.type, EventV2.versionedType(SessionEvent.Text.Delta.type, 1)))
        .all()
        .pipe(Effect.orDie)
      expect(live).toHaveLength(32)
      expect(deltas).toHaveLength(0)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Stream many chunks" },
        {
          type: "assistant",
          finish: "stop",
          content: [{ type: "text", id: "text-many", text: Array.from({ length: 32 }, (_, index) => `${index},`).join("") }],
        },
      ])
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* events.remove(sessionID)
      yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Stream many chunks" },
        {
          type: "assistant",
          finish: "stop",
          content: [{ type: "text", id: "text-many", text: Array.from({ length: 32 }, (_, index) => `${index},`).join("") }],
        },
      ])
    }),
  )

  it.effect("durably closes partial text when the provider stream fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Fail after text" }), resume: false })
      const failure = new LLMError({
        module: "test",
        method: "stream",
        reason: new TransportReason({ message: "Provider unavailable" }),
      })

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-partial" }),
          LLMEvent.textDelta({ id: "text-partial", text: "Partial" }),
        ]),
        Stream.fail(failure),
      )

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail after text" },
        { type: "assistant", content: [{ type: "text", id: "text-partial", text: "Partial" }] },
      ])
    }),
  )

  it.effect("durably closes partial text when the provider stream is interrupted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Interrupt after text" }), resume: false })
      const streamed = yield* Deferred.make<void>()

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-interrupted" }),
          LLMEvent.textDelta({ id: "text-interrupted", text: "Partial" }),
        ]),
        Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      )

      const fiber = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamed)
      yield* Fiber.interrupt(fiber)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt after text" },
        { type: "assistant", content: [{ type: "text", id: "text-interrupted", text: "Partial" }] },
      ])
    }),
  )

  it.effect("rejects duplicate streamed text starts", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [LLMEvent.textStart({ id: "text-1" }), LLMEvent.textStart({ id: "text-1" })]

      expect(yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))).toBe("Duplicate text start: text-1")
    }),
  )

  it.effect("broadcasts provider reasoning deltas without storing projection rewrites", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Think in chunks" }), resume: false })
      const live: SessionEvent.Reasoning.Delta[] = []
      const unsubscribe = yield* EventV2.Service.pipe(
        Effect.flatMap((events) => events.listen((event) => Effect.sync(() => {
          if (event.type === SessionEvent.Reasoning.Delta.type) live.push(event as SessionEvent.Reasoning.Delta)
        }))),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "reasoning-many" }),
        ...Array.from({ length: 32 }, (_, index) => LLMEvent.reasoningDelta({ id: "reasoning-many", text: `${index},` })),
        LLMEvent.reasoningEnd({ id: "reasoning-many" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]

      yield* session.resume(sessionID)

      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const deltas = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.type, EventV2.versionedType(SessionEvent.Reasoning.Delta.type, 1)))
        .all()
        .pipe(Effect.orDie)
      const expected = Array.from({ length: 32 }, (_, index) => `${index},`).join("")
      expect(live).toHaveLength(32)
      expect(deltas).toHaveLength(0)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Think in chunks" },
        { type: "assistant", finish: "stop", content: [{ type: "reasoning", id: "reasoning-many", text: expected }] },
      ])
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* events.remove(sessionID)
      yield* db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Think in chunks" },
        { type: "assistant", finish: "stop", content: [{ type: "reasoning", id: "reasoning-many", text: expected }] },
      ])
    }),
  )

  it.effect("durably closes partial reasoning when the provider stream fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Fail after reasoning" }), resume: false })
      const failure = new LLMError({
        module: "test",
        method: "stream",
        reason: new TransportReason({ message: "Provider unavailable" }),
      })

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.reasoningStart({ id: "reasoning-partial" }),
          LLMEvent.reasoningDelta({ id: "reasoning-partial", text: "Partial" }),
        ]),
        Stream.fail(failure),
      )

      expect(yield* session.resume(sessionID).pipe(Effect.flip)).toBe(failure)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Fail after reasoning" },
        { type: "assistant", content: [{ type: "reasoning", id: "reasoning-partial", text: "Partial" }] },
      ])
    }),
  )

  it.effect("durably closes partial reasoning when the provider stream is interrupted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: new Prompt({ text: "Interrupt after reasoning" }), resume: false })
      const streamed = yield* Deferred.make<void>()

      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      responseStream = Stream.concat(
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.reasoningStart({ id: "reasoning-interrupted" }),
          LLMEvent.reasoningDelta({ id: "reasoning-interrupted", text: "Partial" }),
        ]),
        Stream.fromEffect(Deferred.succeed(streamed, undefined)).pipe(Stream.flatMap(() => Stream.never)),
      )

      const fiber = yield* session.resume(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(streamed)
      yield* Fiber.interrupt(fiber)
      expect(yield* session.context(sessionID)).toMatchObject([
        { type: "user", text: "Interrupt after reasoning" },
        { type: "assistant", content: [{ type: "reasoning", id: "reasoning-interrupted", text: "Partial" }] },
      ])
    }),
  )

  it.effect("rejects malformed streamed tool input ordering", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      responses = undefined
      streamGate = undefined
      streamStarted = undefined
      response = [LLMEvent.toolInputDelta({ id: "call-1", name: "read", text: "{}" })]

      expect(yield* session.resume(sessionID).pipe(Effect.catchDefect(Effect.succeed))).toBe("Tool input delta before start: call-1")
    }),
  )
})
