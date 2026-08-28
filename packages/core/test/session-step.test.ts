import { expect } from "bun:test"
import { LanguageModel, LLM, LLMEvent } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols/openai-chat"
import { TestLLM } from "@opencode-ai/ai/testing"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStep } from "@opencode-ai/core/session/runner/step"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { Money } from "@opencode-ai/schema/money"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { asc, eq } from "drizzle-orm"
import { Cause, Effect, Exit, Fiber, Latch, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      [Bus.node, Bus.configured({ persist: true })],
    ]),
    TestLLM.testLayer(),
  ),
)

for (const [kind, ending] of [
  ["text", "open"],
  ["reasoning", "open"],
  ["text", "finish"],
  ["reasoning", "finish"],
  ["text", "eof"],
  ["reasoning", "eof"],
  ["text", "end"],
  ["reasoning", "end"],
  ["text", "interrupt"],
  ["reasoning", "interrupt"],
] as const) {
  it.effect(`settles batched ${kind} publication with ${ending}`, () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bus = yield* Bus.Service
      const llm = yield* TestLLM.Test
      const paused = yield* Latch.make()
      const finish = yield* Latch.make()
      const defected = yield* Latch.make()
      const defect = new Error("delta listener defect")
      const die = Effect.die(defect).pipe(Effect.ensuring(defected.open))
      let failed = false
      yield* bus.listen((event) =>
        Effect.suspend(() => {
          if (event.type !== `session.${kind}.delta` || failed || ending === "end" || ending === "interrupt")
            return Effect.void
          failed = true
          // EOF wins the race before the defect, exercising the final post-flush check.
          if (ending === "eof") return finish.open.pipe(Effect.andThen(Effect.yieldNow), Effect.andThen(die))
          return ending === "finish" ? finish.open.pipe(Effect.andThen(die)) : die
        }),
      )
      const sessionID = Session.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      yield* database.db
        .insert(ProjectTable)
        .values({
          id: Project.ID.global,
          worktree: AbsolutePath.make("/project"),
          sandboxes: [],
        })
        .run()
      yield* database.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "delta-failure",
          directory: "/project",
          version: "test",
        })
        .run()
      const steps = yield* SessionStep.make.pipe(
        Effect.provide(Layer.mock(Snapshot.Service)({ capture: () => Effect.succeed(undefined) })),
      )
      const model = SessionRunnerModel.resolved(
        LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
        {
          capabilities: { tools: false, input: ["text"], output: ["text"] },
          limit: { context: 100_000, output: 1_000 },
          cost: [],
        },
      )
      yield* llm.push(
        Stream.make(
          { type: `${kind}-start`, id: "burst" } satisfies LLMEvent,
          { type: `${kind}-delta`, id: "burst", text: "complete short burst" } satisfies LLMEvent,
        ).pipe(
          Stream.concat(
            Stream.fromEffect(paused.open.pipe(Effect.andThen(finish.await))).pipe(
              Stream.flatMap(() =>
                ending === "eof"
                  ? Stream.empty
                  : Stream.fromIterable(TestLLM.stop({ type: `${kind}-end`, id: "burst" })),
              ),
            ),
          ),
        ),
      )
      const attempt = yield* steps
        .attempt({
          sessionID,
          assistantMessageID,
          agent: Agent.defaultID,
          model,
          prepared: {
            retry: () => Effect.void,
            request: LLM.request({ model: model.model, prompt: "Stream a short burst" }),
            options: {},
            executeTool: () => Effect.die("unexpected tool"),
          },
          retry: () => Effect.die("unexpected provider retry"),
          recoverContinuation: true,
          recoverOverflow: Effect.succeed(false),
        })
        .pipe(Effect.forkScoped)
      yield* paused.await
      if (ending === "end") yield* finish.open
      if (ending === "interrupt") yield* Fiber.interrupt(attempt)
      yield* TestClock.adjust(100)
      if (ending === "open" || ending === "finish" || ending === "eof") yield* defected.await
      yield* TestClock.adjust(0)
      const result = attempt.pollUnsafe()
      expect(result).toBeDefined()
      if (ending === "end") expect(result && Exit.isSuccess(result)).toBe(true)
      if (ending === "interrupt")
        expect(result && Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true)
      if (ending === "open" || ending === "finish" || ending === "eof")
        expect(result && Exit.isFailure(result) && Cause.squash(result.cause)).toBe(defect)
      yield* finish.open
      yield* Fiber.await(attempt)
      yield* TestClock.adjust(1_000)
      const message = yield* database.db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
      expect(message?.data).toMatchObject({ content: [{ type: kind, text: "complete short burst" }] })
      const events = yield* database.db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
      expect(events.some((event) => event.type === "session.step.ended.1")).toBe(ending === "end")
      expect(events.filter((event) => event.type === `session.${kind}.ended.1`)).toHaveLength(1)
    }),
  )
}

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
                return { content: "Completed tool" }
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
      expect(types.filter((type) => type === terminal)).toHaveLength(1)
      expect(
        types.indexOf(fixture.toolChoice === "none" ? "session.tool.failed.2" : "session.tool.success.2"),
      ).toBeLessThan(types.indexOf(terminal))
    }),
  )
}
