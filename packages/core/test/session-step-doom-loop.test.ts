import { expect, test } from "bun:test"
import { LanguageModel, LLM, LLMEvent } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Snapshot } from "@opencode/core/snapshot"
import { ToolOutput } from "@opencode/core/tool-output"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { eq } from "drizzle-orm"
import { Effect, Exit, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node, SessionStore.node]),
      [Bus.node.replace(Bus.configured({ persist: true }))],
    ),
    TestLLM.testLayer(),
  ),
)

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

const input = { query: "same" }
const triple = TestLLM.toolCalls(
  LLMEvent.toolCall({ id: "call-1", name: "test", input }),
  LLMEvent.toolCall({ id: "call-2", name: "test", input }),
  LLMEvent.toolCall({ id: "call-3", name: "test", input }),
)
const single = TestLLM.toolCalls(LLMEvent.toolCall({ id: "call-4", name: "test", input }))
const pair = TestLLM.toolCalls(
  LLMEvent.toolCall({ id: "call-1", name: "test", input }),
  LLMEvent.toolCall({ id: "call-2", name: "test", input }),
)

const setup = Effect.fn("setup")(function* (overrides: Partial<Permission.Interface>) {
  const db = (yield* Database.Service).db
  const llm = yield* TestLLM.Test
  const sessionID = Session.ID.create()
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({ id: sessionID, project_id: Project.ID.global, slug: "doom", directory: "/project", version: "test" })
    .run()
  const steps = yield* SessionStep.make.pipe(
    Effect.provide(
      Layer.merge(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(Snapshot.ID.make("snap")),
          files: () => Effect.succeed([]),
        }),
        permissionLayer(overrides),
      ),
    ),
  )
  const run = (assistantMessageID: SessionMessage.ID, onExecute: () => void) =>
    steps
      .attempt({
        isLocationClosed: () => false,
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        model,
        prepared: {
          retry: () => Effect.void,
          request: LLM.request({ model: model.model, prompt: "Loop" }),
          options: {},
          executeTool: () =>
            Effect.sync(() => {
              onExecute()
              return { content: [{ type: "text", text: "Completed tool" }] }
            }),
        },
        retry: (_cause, _error, retry) => Effect.succeed(retry ? { retry: true, attempt: 2, delay: 0 } : { retry: false }),
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.exit)
  return { db, llm, run }
})

const denied = () =>
  new Permission.BlockedError({ rules: [], permission: "doom_loop", resources: ["test"] })

it.effect("warns when a tool call repeats with identical input a third time", () =>
  Effect.gen(function* () {
    let executions = 0
    let checks = 0
    const { db, llm, run } = yield* setup({
      assert: () => {
        checks++
        return Effect.fail(denied())
      },
    })
    const assistantMessageID = SessionMessage.ID.create()
    yield* llm.push(triple)
    const result = yield* run(assistantMessageID, () => executions++)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result))
      expect(result.value).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    expect(executions).toBe(2)
    expect(checks).toBe(1)
    const message = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .get()
    expect(message?.data).toMatchObject({
      content: [
        { type: "tool", state: { status: "completed" } },
        { type: "tool", state: { status: "completed" } },
        {
          type: "tool",
          state: {
            status: "error",
            metadata: { doomLoop: "warn" },
            error: { message: expect.stringContaining("Doom loop detected: the same test tool call") },
          },
        },
      ],
    })
  }),
)

it.effect("stops the turn when the loop repeats after the warning", () =>
  Effect.gen(function* () {
    let executions = 0
    let checks = 0
    const { db, llm, run } = yield* setup({
      assert: () => {
        checks++
        return Effect.fail(denied())
      },
    })
    yield* llm.push(triple)
    const first = yield* run(SessionMessage.ID.create(), () => executions++)
    expect(Exit.isSuccess(first)).toBe(true)
    expect(executions).toBe(2)
    const assistantMessageID = SessionMessage.ID.create()
    yield* llm.push(single)
    const second = yield* run(assistantMessageID, () => executions++)
    expect(Exit.isSuccess(second)).toBe(true)
    if (Exit.isSuccess(second))
      expect(second.value).toEqual(SessionStep.Outcome.Completed({ needsContinuation: false }))
    expect(executions).toBe(2)
    expect(checks).toBe(2)
    const message = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, assistantMessageID))
      .get()
    expect(message?.data).toMatchObject({
      content: [
        {
          type: "tool",
          state: {
            status: "error",
            error: { message: "Doom loop repeated after warning. Stopping this turn." },
          },
        },
      ],
    })
  }),
)

it.effect("executes the repeated call when the doom_loop rule allows", () =>
  Effect.gen(function* () {
    let executions = 0
    let checks = 0
    const { llm, run } = yield* setup({
      assert: () => {
        checks++
        return Effect.void
      },
    })
    const assistantMessageID = SessionMessage.ID.create()
    yield* llm.push(triple)
    const result = yield* run(assistantMessageID, () => executions++)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result))
      expect(result.value).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    expect(executions).toBe(3)
    expect(checks).toBe(1)
  }),
)

it.effect("leaves permissions untouched below the repeat threshold", () =>
  Effect.gen(function* () {
    let executions = 0
    let checks = 0
    const { llm, run } = yield* setup({
      assert: () => {
        checks++
        return Effect.void
      },
    })
    const assistantMessageID = SessionMessage.ID.create()
    yield* llm.push(pair)
    const result = yield* run(assistantMessageID, () => executions++)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result))
      expect(result.value).toEqual(SessionStep.Outcome.Completed({ needsContinuation: true }))
    expect(executions).toBe(2)
    expect(checks).toBe(0)
  }),
)

test("the base policy asks on doom_loop", () => {
  const permissions = Agent.Info.default(Agent.ID.make("test")).permissions
  expect(Permission.evaluate("doom_loop", "bash", permissions).effect).toBe("ask")
})
