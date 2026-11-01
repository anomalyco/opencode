import { expect } from "bun:test"
import { ai, LanguageModel, LLMEvent } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerLoopState } from "@opencode/core/session/runner/loop-state"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { SessionTable } from "@opencode/core/session/sql"
import { Snapshot } from "@opencode/core/snapshot"
import { ToolOutput } from "@opencode/core/tool-output"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      Bus.node.replace(Bus.configured({ persist: true })),
    ]),
    TestLLM.testLayer(),
    SessionRunnerLoopState.layer,
  ),
)

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "test-model", provider: "test", route: OpenAIChat.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 100_000, output: 10_000 },
    cost: [
      {
        input: Money.USDPerMillionTokens.make(1),
        output: Money.USDPerMillionTokens.make(2),
        cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
      },
    ],
  },
)

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const llm = yield* TestLLM.Test
  const sessionID = Session.ID.create()
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "loop", directory: "/project", version: "test" })
    .run()
  const steps = yield* SessionStep.make.pipe(
    Effect.provide(
      Layer.merge(
        SessionRunnerLoopState.layer,
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(undefined),
          files: () => Effect.succeed([]),
        }),
      ),
    ),
  )
  let executions = 0
  const attempt = (events: readonly LLMEvent[]) =>
    Effect.gen(function* () {
      yield* llm.push(events)
      return yield* steps.attempt({
        isLocationClosed: () => false,
        sessionID,
        assistantMessageID: SessionMessage.ID.create(),
        agent: Agent.defaultID,
        model,
        prepared: {
          retry: () => Effect.void,
          request: ai.request({ model: model.model, prompt: "loop" }),
          options: {},
          executeTool: () =>
            Effect.sync(() => {
              executions++
              return { content: [{ type: "text" as const, text: "ok" }] }
            }),
        },
        retry: () => Effect.succeed({ retry: false as const }),
        recoverContinuation: false,
        recoverOverflow: Effect.succeed(false),
      })
    })
  const events = () =>
    db
      .select({ type: EventTable.type })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
  return { db, llm, sessionID, steps, attempt, events, executions: () => executions }
})

const toolCall = (id: string) => TestLLM.toolCall(id, "bash", { command: "ls" })

it.effect("drops the third identical cross-step tool call and returns a loop nudge", () =>
  Effect.gen(function* () {
    const s = yield* setup
    expect(yield* s.attempt(toolCall("call-1"))).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    expect(yield* s.attempt(toolCall("call-2"))).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    const third = yield* s.attempt(toolCall("call-3"))
    expect(third._tag).toBe("LoopNudge")
    expect(third._tag === "LoopNudge" && third.text).toContain("repeated the same tool call")
    expect(s.executions()).toBe(2)
    const types = (yield* s.events()).map((event) => event.type)
    expect(types.filter((type) => type === "session.tool.failed.2")).toHaveLength(1)
    expect(types.filter((type) => type === "session.tool.success.2")).toHaveLength(2)
  }),
)

it.effect("does not fire when the tool input changes", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.attempt(TestLLM.toolCall("call-1", "bash", { command: "ls" }))
    yield* s.attempt(TestLLM.toolCall("call-2", "bash", { command: "pwd" }))
    const third = yield* s.attempt(TestLLM.toolCall("call-3", "bash", { command: "ls" }))
    expect(third).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    expect(s.executions()).toBe(3)
  }),
)

it.effect("kill switch: OPENCODE_TOOL_LOOP_DETECT=0 disables the cross-step rule", () =>
  Effect.gen(function* () {
    const previous = process.env.OPENCODE_TOOL_LOOP_DETECT
    process.env.OPENCODE_TOOL_LOOP_DETECT = "0"
    try {
      const s = yield* setup
      yield* s.attempt(toolCall("call-1"))
      yield* s.attempt(toolCall("call-2"))
      const third = yield* s.attempt(toolCall("call-3"))
      expect(third).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
      expect(s.executions()).toBe(3)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_TOOL_LOOP_DETECT
      else process.env.OPENCODE_TOOL_LOOP_DETECT = previous
    }
  }),
)

const LOOP_LINE = "I need to check the file again and again.\n"

it.effect("interrupts a reasoning loop and returns a nudge carrying the pre-loop work", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const result = yield* s.attempt(
      TestLLM.stop(
        LLMEvent.reasoningStart({ id: "reasoning-1" }),
        ...Array.from({ length: 200 }, () => LLMEvent.reasoningDelta({ id: "reasoning-1", text: LOOP_LINE })),
        LLMEvent.reasoningEnd({ id: "reasoning-1" }),
      ),
    )
    expect(result._tag).toBe("LoopNudge")
    expect(result._tag === "LoopNudge" && result.text).toContain("entered a repetition loop")
    expect(result._tag === "LoopNudge" && result.text).not.toContain(LOOP_LINE.repeat(2))
  }),
)

it.effect("loop state caps nudges per turn and clears on a new turn", () =>
  Effect.gen(function* () {
    const state = yield* SessionRunnerLoopState.Service
    const sessionID = Session.ID.create()
    expect(yield* state.takeNudge(sessionID)).toBe(true)
    expect(yield* state.takeNudge(sessionID)).toBe(true)
    expect(yield* state.takeNudge(sessionID)).toBe(false)
    yield* state.clear(sessionID)
    expect(yield* state.takeNudge(sessionID)).toBe(true)
  }),
)
