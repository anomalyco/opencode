import { expect } from "bun:test"
import { LanguageModel, LLM, LLMClient, LLMEvent } from "@opencode-ai/ai"
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
import { Effect, Exit, Layer } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      [Bus.node, Bus.configured({ persist: true })],
    ]),
    TestLLM.layer(),
  ),
)

for (const finish of ["stop", "content-filter"] as const) {
  it.effect(`settles ${finish} with snapshot files and nonzero usage after its tool`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const llm = yield* TestLLM.Service
      const sessionID = Session.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      const start = Snapshot.ID.make("before")
      const end = Snapshot.ID.make("after")
      const files = [RelativePath.make("changed.ts")]
      let captures = 0
      const steps = yield* SessionStep.make.pipe(
        Effect.provideService(LLMClient.Service, llm.client),
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
            reason: { normalized: finish },
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
            request: LLM.request({ model: model.model, prompt: "Run one tool" }),
            options: {},
            executeTool: () => Effect.succeed({ content: "Completed tool" }),
          },
          toolsDisabled: false,
          recoverContinuation: true,
          recoverOverflow: Effect.succeed(false),
        })
        .pipe(Effect.exit)
      expect(Exit.isSuccess(result)).toBe(finish === "stop")
      expect(llm.requests).toHaveLength(1)
      expect(captures).toBe(2)
      const message = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .get()
      expect(message?.data).toMatchObject({
        finish,
        tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 2 } },
        snapshot: { start, end, files },
        content: [{ type: "tool", state: { status: "completed" } }],
      })
      expect(message?.data).toHaveProperty("cost", expect.closeTo(0.0000233, 10))
      const events = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
      const types = events.map((event) => event.type)
      const terminal = finish === "stop" ? "session.step.ended.1" : "session.step.failed.1"
      expect(types.filter((type) => type === terminal)).toHaveLength(1)
      expect(types.indexOf("session.tool.success.2")).toBeLessThan(types.indexOf(terminal))
    }),
  )
}
