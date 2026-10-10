import { expect } from "bun:test"
import { LanguageModel, LLM, LLMEvent } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import type { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Snapshot } from "@opencode/core/snapshot"
import { ToolOutput } from "@opencode/core/tool-output"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { asc, eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      Bus.node.replace(Bus.configured({ persist: true })),
    ]),
    TestLLM.testLayer(),
  ),
)

for (const fixture of [
  { finish: "stop", toolChoice: undefined },
  { finish: "content-filter", toolChoice: undefined },
  { finish: "stop", toolChoice: "none" },
] as const) {
  it.effect(`settles ${fixture.finish} with tool choice ${fixture.toolChoice ?? "default"}`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const llm = yield* TestLLM.Test
      const sessionID = Session.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      const start = Snapshot.ID.make("before")
      const end = Snapshot.ID.make("after")
      const files = [RelativePath.make("changed.ts")]
      let captures = 0
      let executions = 0
      const steps = yield* SessionStep.make.pipe(
        Effect.provide(
          Layer.mock(Snapshot.Service)({
            capture: () => Effect.sync(() => (captures++ === 0 ? start : end)),
            files: (input) => {
              expect(input).toEqual({ from: start, to: end })
              return Effect.succeed(files)
            },
          }),
        ),
      )
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: Project.ID.global, slug: "step", directory: "/project", version: "test" })
        .run()
      const model = SessionRunnerModel.resolved(
        LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
        {
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          limit: { context: 100_000, output: 1_000 },
          cost: [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
            },
          ],
        },
      )
      yield* llm.push(
        TestLLM.complete(
          {
            reason: { normalized: fixture.finish },
            usage: {
              inputTokens: 15,
              outputTokens: 6,
              nonCachedInputTokens: 10,
              cacheReadInputTokens: 3,
              cacheWriteInputTokens: 2,
              reasoningTokens: 2,
            },
          },
          LLMEvent.toolCall({ id: "call-test", name: "test", input: {} }),
        ),
      )
      const result = yield* steps
        .attempt({
          isLocationClosed: () => false,
          sessionID,
          assistantMessageID,
          agent: Agent.defaultID,
          model,
          prepared: {
            retry: () => Effect.void,
            request: LLM.request({ model: model.model, prompt: "Run one tool", toolChoice: fixture.toolChoice }),
            options: {},
            executeTool: () =>
              Effect.sync(() => {
                executions++
                return { content: [{ type: "text", text: "Completed tool" }] }
              }),
          },
          retry: (_cause, _error, retry) =>
            Effect.succeed(retry ? { retry: true, attempt: 2, delay: 0 } : { retry: false }),
          recoverContinuation: true,
          recoverOverflow: Effect.succeed(false),
        })
        .pipe(Effect.exit)
      expect(Exit.isSuccess(result)).toBe(fixture.finish === "stop")
      expect(executions).toBe(fixture.toolChoice === "none" ? 0 : 1)
      if (Exit.isSuccess(result))
        expect(result.value).toEqual(
          SessionStep.Outcome.Completed({ needsContinuation: fixture.toolChoice !== "none" }),
        )
      expect(yield* llm.requests()).toHaveLength(1)
      expect(captures).toBe(2)
      const message = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
      expect(message?.data).toMatchObject({
        finish: fixture.finish,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
        snapshot: { start, end, files },
        content: [{ type: "tool", state: { status: fixture.toolChoice === "none" ? "error" : "completed" } }],
      })
      expect(message?.data).toHaveProperty("cost", expect.closeTo(0.0000233, 10))
      const events = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
      const types = events.map((event) => event.type)
      const terminal = fixture.finish === "stop" ? "session.step.ended.1" : "session.step.failed.1"
      expect(types.filter((type) => type === "session.step.streamed.1")).toHaveLength(1)
      expect(types.filter((type) => type === terminal)).toHaveLength(1)
      expect(types.indexOf("session.step.streamed.1")).toBeLessThan(types.indexOf(terminal))
      expect(
        types.indexOf(fixture.toolChoice === "none" ? "session.tool.failed.2" : "session.tool.success.2"),
      ).toBeLessThan(types.indexOf(terminal))
    }),
  )
}

/** Runs one step against a provider stream that hangs, interrupts it once it is underway, and reports its record. */
const interruptStep = Effect.fnUntraced(function* (input: {
  readonly events: readonly LLMEvent[]
  readonly snapshots: Layer.Layer<Snapshot.Service>
  readonly executeTool?: SessionModelRequest.Prepared["executeTool"]
  readonly underway: Effect.Effect<void>
}) {
  const db = (yield* Database.Service).db
  const llm = yield* TestLLM.Test
  const sessionID = Session.ID.create()
  const assistantMessageID = SessionMessage.ID.create()
  const steps = yield* SessionStep.make.pipe(Effect.provide(input.snapshots))
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "step", directory: "/project", version: "test" })
    .run()
  const model = SessionRunnerModel.resolved(
    LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
    {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      limit: { context: 100_000, output: 1_000 },
      cost: [],
    },
  )
  yield* llm.push(TestLLM.hangAfter(...input.events))
  const fiber = yield* steps
    .attempt({
      isLocationClosed: () => false,
      sessionID,
      assistantMessageID,
      agent: Agent.defaultID,
      model,
      prepared: {
        retry: () => Effect.void,
        request: LLM.request({ model: model.model, prompt: "Interrupt me" }),
        options: {},
        executeTool: input.executeTool ?? (() => Effect.die(new Error("unexpected tool execution"))),
      },
      retry: () => Effect.succeed({ retry: false }),
      recoverContinuation: true,
      recoverOverflow: Effect.succeed(false),
    })
    .pipe(Effect.forkChild)
  yield* input.underway
  // A step held open by end-of-step work would hold the interrupt open too.
  const interrupted = yield* Fiber.interrupt(fiber).pipe(Effect.timeoutOption("2 seconds"))
  expect(Option.isSome(interrupted)).toBeTrue()
  const message = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, assistantMessageID))
    .get()
  const events = yield* db
    .select({ type: EventTable.type })
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
  return { message, events: events.map((event) => event.type) }
})

it.live("interrupts a step without local tools without capturing the worktree again", () =>
  Effect.gen(function* () {
    const start = Snapshot.ID.make("before")
    const bus = yield* Bus.Service
    const started = yield* bus
      .subscribe(SessionEvent.Step.Started)
      .pipe(Stream.runHead, Effect.forkScoped({ startImmediately: true }))
    let captures = 0
    const result = yield* interruptStep({
      events: [LLMEvent.stepStart({ index: 0 }), LLMEvent.textStart({ id: "text" })],
      // A second capture models a slow worktree: it never finishes.
      snapshots: Layer.mock(Snapshot.Service)({
        capture: () => (captures++ === 0 ? Effect.succeed(start) : Effect.never),
        files: () => Effect.die(new Error("unexpected snapshot diff")),
      }),
      underway: Fiber.join(started).pipe(Effect.asVoid),
    })

    expect(captures).toBe(1)
    expect(result.message?.data).toMatchObject({
      error: { type: "aborted", message: "Step interrupted" },
      snapshot: { start, end: start, files: [] },
    })
    expect(result.events).toContain("session.step.failed.1")
  }),
)

it.live("keeps file tracking for an interrupted step that ran local tools", () =>
  Effect.gen(function* () {
    const start = Snapshot.ID.make("before")
    const end = Snapshot.ID.make("after")
    const files = [RelativePath.make("changed.ts")]
    const toolStarted = yield* Deferred.make<void>()
    let captures = 0
    const result = yield* interruptStep({
      events: [LLMEvent.stepStart({ index: 0 }), LLMEvent.toolCall({ id: "call-edit", name: "edit", input: {} })],
      snapshots: Layer.mock(Snapshot.Service)({
        capture: () => Effect.sync(() => (captures++ === 0 ? start : end)),
        files: (input) => {
          expect(input).toEqual({ from: start, to: end })
          return Effect.succeed(files)
        },
      }),
      executeTool: () => Deferred.succeed(toolStarted, undefined).pipe(Effect.andThen(Effect.never)),
      underway: Deferred.await(toolStarted),
    })

    expect(captures).toBe(2)
    expect(result.message?.data).toMatchObject({
      error: { type: "aborted", message: "Step interrupted" },
      snapshot: { start, end, files },
    })
    expect(result.events).toContain("session.step.failed.1")
  }),
)
