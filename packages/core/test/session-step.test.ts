import { expect } from "bun:test"
import { AIError, AuthenticationError, LanguageModel, LLM, LLMEvent } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Integration } from "@opencode/core/integration"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { Snapshot } from "@opencode/core/snapshot"
import { ToolOutput } from "@opencode/core/tool-output"
import { Money } from "@opencode/schema/money"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { asc, eq } from "drizzle-orm"
import { Effect, Exit, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(
      LayerNode.group([
        Database.node,
        Bus.node,
        SessionProjector.node,
        ToolOutput.node,
        Credential.node,
        Integration.node,
      ]),
      [Bus.node.replace(Bus.configured({ persist: true }))],
    ),
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
          recoverAuth: true,
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

it.effect("recovers authentication error when recoverAuth is true and integration returns recovered credential", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const llm = yield* TestLLM.Test
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    const sessionID = Session.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    const integrationID = Integration.ID.make("test-integration")
    const methodID = Integration.MethodID.make("oauth")

    yield* integrations.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Test Integration"
      })
      editor.method.update({
        integrationID,
        method: { id: methodID, type: "oauth", label: "OAuth" },
        authorize: () =>
          Effect.succeed({
            mode: "auto" as const,
            url: "https://example.com/oauth",
            instructions: "Login",
            callback: Effect.succeed(
              Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: "token-old",
                refresh: "token-old",
                expires: 0,
              }),
            ),
          }),
        recover: (value, status, response) => {
          expect(response).toEqual({ headers: { "x-auth": "rejected" }, body: "Provider auth rejection" })
          return Effect.succeed(
            status === 401
              ? Credential.OAuth.make({
                  ...value,
                  access: "token-recovered",
                })
              : undefined,
          )
        },
      })
    })

    yield* integrations.oauth.connect({ integrationID, methodID })
    yield* Effect.yieldNow
    const cred = (yield* credentials.list(integrationID))[0]

    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () => Effect.succeed(Snapshot.ID.make("before")),
          files: () => Effect.succeed([]),
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
        cost: [],
        connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
        integrationID,
      },
    )

    yield* llm.push(
      Stream.fail(
        new AIError({
          reason: new AuthenticationError({
            message: "Unauthorized",
            http: { url: "https://api.example.com/v1", status: 401, headers: { "x-auth": "rejected" } },
            body: "Provider auth rejection",
          }),
        }),
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
          request: LLM.request({ model: model.model, prompt: "Hello" }),
          options: {},
          executeTool: () => Effect.succeed({ content: [] }),
        },
        retry: () => Effect.succeed({ retry: false }),
        recoverContinuation: true,
        recoverAuth: true,
        recoverOverflow: Effect.succeed(false),
      })
      .pipe(Effect.exit)

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual(SessionStep.Outcome.RecoverAuth())
    }

    const updated = yield* credentials.get(cred.id)
    if (updated?.value.type === "oauth") {
      expect(updated.value.access).toBe("token-recovered")
    }
  }),
)
;[false, true].forEach((outputStarted) =>
  it.effect(`does not recover authentication after ${outputStarted ? "durable output" : "a previous recovery"}`, () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const llm = yield* TestLLM.Test
      const integrations = yield* Integration.Service
      const credentials = yield* Credential.Service
      const sessionID = Session.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      const integrationID = Integration.ID.make("test-integration-no-retry")
      const methodID = Integration.MethodID.make("oauth")
      let recoverCalls = 0

      yield* integrations.transform((editor) => {
        editor.update(integrationID, (integration) => {
          integration.name = "Test Integration"
        })
        editor.method.update({
          integrationID,
          method: { id: methodID, type: "oauth", label: "OAuth" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/oauth",
              instructions: "Login",
              callback: Effect.succeed(
                Credential.OAuth.make({
                  type: "oauth",
                  methodID,
                  access: "token-old",
                  refresh: "token-old",
                  expires: 0,
                }),
              ),
            }),
          recover: () => {
            recoverCalls++
            return Effect.succeed(undefined)
          },
        })
      })

      yield* integrations.oauth.connect({ integrationID, methodID })
      yield* Effect.yieldNow
      const cred = (yield* credentials.list(integrationID))[0]

      const steps = yield* SessionStep.make.pipe(
        Effect.provide(
          Layer.mock(Snapshot.Service)({
            capture: () => Effect.succeed(Snapshot.ID.make("before")),
            files: () => Effect.succeed([]),
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
          cost: [],
          connection: { type: "credential", id: cred.id, label: "OAuth", method: "oauth" },
          integrationID,
        },
      )

      yield* llm.push(
        (outputStarted
          ? Stream.make(
              LLMEvent.textStart({ id: "partial" }),
              LLMEvent.textDelta({ id: "partial", text: "Already visible" }),
            )
          : Stream.empty
        ).pipe(
          Stream.concat(
            Stream.fail(
              new AIError({
                reason: new AuthenticationError({
                  message: "Unauthorized",
                  http: { url: "https://api.example.com/v1", status: 401, headers: {} },
                }),
              }),
            ),
          ),
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
            request: LLM.request({ model: model.model, prompt: "Hello" }),
            options: {},
            executeTool: () => Effect.succeed({ content: [] }),
          },
          retry: () => Effect.succeed({ retry: false }),
          recoverContinuation: true,
          recoverAuth: outputStarted,
          recoverOverflow: Effect.succeed(false),
        })
        .pipe(Effect.exit)

      expect(recoverCalls).toBe(0)
      expect(Exit.isFailure(result)).toBe(true)
    }),
  ),
)
