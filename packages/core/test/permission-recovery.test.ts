import { expect } from "bun:test"
import { asc, eq, sql } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { ai, LanguageModel, LLMEvent } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { PermissionTable } from "@opencode/core/permission/sql"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStep } from "@opencode/core/session/runner/step"
import { Snapshot } from "@opencode/core/snapshot"
import { ToolOutput } from "@opencode/core/tool-output"
import { SessionParking } from "@opencode/core/session/parking"
import { SessionProjector } from "@opencode/core/session/projector"
import {
  SessionMessageTable,
  SessionPendingStepTable,
  SessionPermissionTable,
  SessionQuestionTable,
  SessionTable,
} from "@opencode/core/session/sql"
import { Tool } from "@opencode/core/tool"
import { Config } from "@opencode/core/config"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Provider } from "@opencode/schema/provider"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { imagePassthrough } from "./lib/image"
import { testEffect } from "./lib/effect"
import { registerToolPlugin } from "./lib/tool"

const it = testEffect(
  Layer.merge(
    AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
      Bus.node.replace(Bus.configured({ persist: true })),
    ]),
    TestLLM.testLayer(),
  ),
)
const sessionID = Session.ID.make("ses_permission_recovery")
const assistantMessageID = SessionMessage.ID.make("msg_permission_recovery")
const requestID = Permission.ID.make("per_recovery")
const questionID = Form.ID.make("frm_recovery")
const prepared = {
  adapter: "question@1" as const,
  input: {
    questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "Continue" }] }],
  },
}

/** Reconstruct all Location services; only the database and durable event bus survive. */
const clients = Effect.fnUntraced(function* (directory = "/project", workspaceID?: Location.Ref["workspaceID"]) {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  return Layer.fresh(
    AppNodeBuilder.build(LayerNode.group([Permission.node, Form.node, Tool.node, Agent.node, PluginHooks.node]), [
      Database.node.replace(Layer.succeed(Database.Service, database)),
      Bus.node.replace(Layer.succeed(Bus.Service, bus)),
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(directory), workspaceID })),
        ),
      ),
      Config.node.replace(Config.testLayer()),
      Image.node.replace(imagePassthrough),
    ]),
  )
})

const createSession = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const bus = yield* Bus.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory: AbsolutePath.make("/project") },
    slug: "recovery",
    version: "test",
    agent: Agent.defaultID,
  })
  yield* db.update(SessionTable).set({ time_suspended: 100 }).where(eq(SessionTable.id, sessionID))
  return { db, bus }
})

const seed = Effect.gen(function* () {
  const fixture = yield* createSession
  const started = yield* fixture.bus.publish(SessionEvent.Step.Started, {
    sessionID,
    assistantMessageID,
    agent: Agent.defaultID,
    model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
    started: 100,
  })
  return { ...fixture, generation: started.durable.seq }
})

const park = Effect.fnUntraced(function* (sibling: "permission" | "question" | undefined = undefined) {
  const fixture = yield* seed
  const questions = [
    {
      callID: "call",
      questionID,
      prepared,
      permission: {
        request: {
          id: requestID,
          sessionID,
          action: "question",
          resources: ["*"],
          save: ["*"],
          source: { type: "tool" as const, messageID: assistantMessageID, id: "call" },
        },
        agent: Agent.defaultID,
      },
    },
    ...(sibling
      ? [
          {
            callID: "sibling",
            questionID: Form.ID.make("frm_sibling"),
            prepared,
            ...(sibling === "permission"
              ? {
                  permission: {
                    request: {
                      id: Permission.ID.make("per_sibling"),
                      sessionID,
                      action: "question",
                      resources: ["*"],
                      save: ["wider-pattern"],
                      source: { type: "tool" as const, messageID: assistantMessageID, id: "sibling" },
                    },
                    agent: Agent.defaultID,
                  },
                }
              : {}),
          },
        ]
      : []),
  ]
  for (const question of questions) {
    yield* fixture.bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID,
      assistantMessageID,
      id: question.callID,
      name: "question",
    })
    yield* fixture.bus.publish(SessionEvent.Tool.Called, {
      sessionID,
      assistantMessageID,
      id: question.callID,
      input: prepared.input,
      executed: false,
    })
  }
  yield* fixture.bus.publish(SessionEvent.Step.Streamed, { sessionID, assistantMessageID })
  yield* SessionParking.park({
    sessionID,
    assistantMessageID,
    generation: fixture.generation,
    step: 3,
    finish: "tool-calls",
    cost: Money.USD.make(1.25),
    tokens: { input: 11, output: 7, reasoning: 2, cache: { read: 3, write: 1 } },
    questions: [questions[0], ...questions.slice(1)],
  })
  return fixture
})

const assistant = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const row = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, assistantMessageID)).get()
  if (!row) throw new Error("Missing assistant")
  const [full = row] = yield* SessionHistory.withParts(db, [row])
  return SessionHistory.decodeMessageRowSync(full)
})

it.effect("parks real preflight and recovers without repeating the provider, hooks, or completed tools", () =>
  Effect.gen(function* () {
    const fixture = yield* createSession
    const llm = yield* TestLLM.Test
    const observed: string[] = []
    yield* fixture.bus.listen((event) =>
      Effect.sync(() => {
        observed.push(event.type)
      }),
    )
    let before = 0
    let evaluated = 0
    let sideEffects = 0
    let captures = 0
    const steps = yield* SessionStep.make.pipe(
      Effect.provide(
        Layer.mock(Snapshot.Service)({
          capture: () =>
            Effect.sync(() => {
              captures++
              return undefined
            }),
        }),
      ),
    )
    const model = SessionRunnerModel.resolved(
      LanguageModel.make({ id: "model", provider: "provider", route: OpenAIChat.route }),
      {
        cost: [],
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        limit: { context: 100_000, output: 1_000 },
      },
    )
    yield* llm.push(
      TestLLM.complete(
        { reason: { normalized: "tool-calls" } },
        LLMEvent.toolCall({ id: "done", name: "touch", input: {} }),
        LLMEvent.toolCall({ id: "call", name: "question", input: {} }),
      ),
    )
    const layer = yield* clients()
    const request = yield* Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.defaultID, (agent) => {
          agent.permissions = []
        }),
      )
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("tool", "execute.before", (event) =>
        Effect.sync(() => {
          before++
          if (event.tool === "question") event.input = prepared.input
        }),
      )
      yield* hooks.register("permission", "evaluate", () =>
        Effect.sync(() => {
          evaluated++
        }),
      )
      yield* registerToolPlugin(QuestionTool.Plugin)
      const tools = yield* Tool.Service
      yield* tools.transform((editor) =>
        editor.add({
          name: "touch",
          description: "One side effect",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          options: { codemode: false },
          execute: () =>
            Effect.sync(() => {
              sideEffects++
              return { output: {}, content: "done" }
            }),
        }),
      )
      const snapshot = yield* tools.snapshot()
      const outcome = yield* steps.attempt({
        sessionID,
        assistantMessageID,
        agent: Agent.defaultID,
        step: 3,
        model,
        isLocationClosed: () => false,
        recoverContinuation: true,
        recoverOverflow: Effect.succeed(false),
        retry: () => Effect.succeed({ retry: false }),
        prepared: {
          request: ai.request({ model: model.model, prompt: "Run the tools" }),
          options: {},
          retry: () => Effect.void,
          prepareAuthorizedQuestion: snapshot.prepareAuthorizedQuestion,
          executeTool: snapshot.execute,
        },
      })
      expect(outcome).toEqual(SessionStep.Outcome.Parked())
      const forms = yield* Form.Service
      const permission = yield* Permission.Service
      expect(yield* forms.list()).toEqual([])
      const requests = yield* permission.list()
      expect(requests).toHaveLength(1)
      return requests[0]
    }).pipe(Effect.provide(layer))
    expect(observed.filter((type) => type === Permission.Event.Replied.type)).toEqual([])
    const pending = yield* fixture.db.select().from(SessionPendingStepTable).get()
    if (!pending) throw new Error("Missing parked Step")
    const restored = yield* clients()
    yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      const forms = yield* Form.Service
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("tool", "execute.before", () => Effect.die("replayed before hook"))
      yield* hooks.register("tool", "execute.after", () => Effect.die("replayed after hook"))
      yield* hooks.register("permission", "evaluate", () => Effect.die("replayed permission"))
      expect(yield* permission.forSession(sessionID)).toEqual([request])
      expect(yield* permission.get(request.id)).toEqual(request)
      yield* permission.reply({ requestID: request.id, reply: "once" })
      expect(yield* permission.list()).toEqual([])
      const questions = yield* forms.list()
      expect(questions).toHaveLength(1)
      yield* forms.reply({ id: questions[0].id, answer: { q0: "Yes" } })
      yield* fixture.bus.publish(SessionEvent.Step.Settled, {
        sessionID,
        assistantMessageID,
        generation: pending.generation,
      })
      expect(yield* assistant).toMatchObject({
        content: [
          { id: "done", state: { status: "completed", content: [{ type: "text", text: "done" }] } },
          { id: "call", state: { status: "completed", input: {}, metadata: { answers: [["Yes"]] } } },
        ],
      })
      expect(yield* fixture.db.select().from(SessionTable).get()).toMatchObject({ resume_step: 4, time_suspended: 100 })
    }).pipe(Effect.provide(restored))
    expect(before).toBe(2)
    expect(evaluated).toBe(1)
    expect(sideEffects).toBe(1)
    expect(captures).toBe(2)
    expect(yield* llm.requests()).toHaveLength(1)
  }),
)

for (const message of [undefined, "Use a different approach", ""] as const) {
  it.effect(`rejects the entire waiting Step (${JSON.stringify(message)})`, () =>
    Effect.gen(function* () {
      const fixture = yield* park("question")
      const layer = yield* clients()
      yield* Effect.gen(function* () {
        const permission = yield* Permission.Service
        const forms = yield* Form.Service
        yield* permission.reply({ requestID, reply: "reject", message })
        expect(yield* permission.list()).toEqual([])
        expect(yield* forms.list()).toEqual([])
        expect(yield* forms.state(Form.ID.make("frm_sibling"))).toMatchObject({ status: "cancelled" })
        expect(yield* permission.reply({ requestID, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
          Permission.NotFoundError,
        )
      }).pipe(Effect.provide(layer))
      expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
      expect(yield* fixture.db.select().from(SessionPermissionTable).get()).toMatchObject({
        status: "reject",
        message: message ?? null,
      })
      expect(yield* fixture.db.select().from(SessionTable).get()).toMatchObject({
        cost: 1.25,
        resume_step: message ? 4 : null,
      })
      expect(yield* assistant).toMatchObject({
        content: [
          { state: { status: "error", error: { type: message ? "permission.rejected" : "aborted" } } },
          { state: { status: "error" } },
        ],
      })
    }),
  )
}

it.effect("Question cancellation also consumes pending permission siblings", () =>
  Effect.gen(function* () {
    const fixture = yield* park("question")
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const forms = yield* Form.Service
      yield* forms.cancel(Form.ID.make("frm_sibling"))
      const permission = yield* Permission.Service
      expect(yield* permission.list()).toEqual([])
      expect(yield* permission.reply({ requestID, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
    }).pipe(Effect.provide(layer))
    expect(yield* fixture.db.select().from(SessionPendingStepTable)).toEqual([])
    expect(yield* fixture.db.select().from(SessionPermissionTable).get()).toMatchObject({ status: "reject" })
  }),
)

it.effect("serializes simultaneous responses and admits exactly one decision", () =>
  Effect.gen(function* () {
    const fixture = yield* park()
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      const results = yield* Effect.all(
        [
          permission.reply({ requestID, reply: "once" }).pipe(Effect.exit),
          permission.reply({ requestID, reply: "reject" }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
      expect(results.filter((result) => result._tag === "Failure")).toHaveLength(1)
    }).pipe(Effect.provide(layer))
    expect(
      (yield* fixture.db.select().from(EventTable)).filter((event) => event.type === "session.permission.resolved.1"),
    ).toHaveLength(1)
  }),
)

it.effect("retains a committed decision when the responder is interrupted before delivery completes", () =>
  Effect.gen(function* () {
    const fixture = yield* park()
    const committed = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const unsubscribe = yield* fixture.bus.listen((event) =>
      event.type === SessionEvent.PermissionResolution.Resolved.type
        ? Deferred.succeed(committed, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.asVoid)
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      const response = yield* permission.reply({ requestID, reply: "once" }).pipe(Effect.forkChild)
      yield* Deferred.await(committed)
      const disconnect = yield* Fiber.interrupt(response).pipe(Effect.forkChild)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(disconnect)
      expect(yield* permission.get(requestID)).toBeUndefined()
      expect(yield* permission.reply({ requestID, reply: "reject" }).pipe(Effect.flip)).toBeInstanceOf(
        Permission.NotFoundError,
      )
    }).pipe(Effect.provide(layer))
    expect(yield* fixture.db.select().from(SessionQuestionTable)).toHaveLength(1)
    expect(yield* fixture.db.select().from(SessionPermissionTable).get()).toMatchObject({ status: "once" })
  }),
)

it.effect("rejects stale generation, call and Session ownership without consuming the pending request", () =>
  Effect.gen(function* () {
    const fixture = yield* park()
    const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
    const decision = {
      sessionID,
      assistantMessageID,
      generation: fixture.generation,
      callID: "call",
      requestID,
      reply: "once" as const,
    }
    for (const input of [
      { ...decision, generation: fixture.generation + 1 },
      { ...decision, callID: "other" },
      { ...decision, assistantMessageID: SessionMessage.ID.make("msg_other") },
      { ...decision, sessionID: Session.ID.make("ses_other") },
    ]) {
      expect(
        (yield* fixture.bus.publish(SessionEvent.PermissionResolution.Resolved, input).pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
    }
    expect(
      yield* fixture.db
        .update(SessionMessageTable)
        .set({ step_started_seq: null })
        .where(eq(SessionMessageTable.id, assistantMessageID))
        .pipe(Effect.exit),
    ).toMatchObject({ _tag: "Failure" })
    expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([])
    expect(yield* fixture.db.select().from(SessionPermissionTable).get()).toMatchObject({ status: "pending" })
  }),
)

it.effect("saves always atomically and releases siblings without broadening their saved scopes", () =>
  Effect.gen(function* () {
    const fixture = yield* park("permission")
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) =>
        editor.update(Agent.defaultID, (agent) => {
          agent.permissions = []
        }),
      )
      const permission = yield* Permission.Service
      yield* permission.reply({ requestID, reply: "always" })
      expect(yield* permission.list()).toEqual([])
    }).pipe(Effect.provide(layer))
    expect(yield* fixture.db.select().from(PermissionTable)).toMatchObject([{ action: "question", resource: "*" }])
    expect(yield* fixture.db.select().from(PermissionTable)).toHaveLength(1)
    expect(yield* fixture.db.select().from(SessionQuestionTable)).toHaveLength(2)
  }),
)

it.effect("configured denies still prevent saved rules from releasing another pending permission", () =>
  Effect.gen(function* () {
    const fixture = yield* park("permission")
    yield* fixture.db
      .update(SessionPermissionTable)
      .set({ agent: Agent.ID.make("denied") })
      .where(eq(SessionPermissionTable.id, Permission.ID.make("per_sibling")))
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => {
        editor.update(Agent.defaultID, (agent) => {
          agent.permissions = []
        })
        editor.update(Agent.ID.make("denied"), (agent) => {
          agent.permissions = [{ action: "question", resource: "*", effect: "deny" }]
        })
      })
      const permission = yield* Permission.Service
      yield* permission.reply({ requestID, reply: "always" })
      expect(yield* permission.list()).toMatchObject([{ id: "per_sibling" }])
    }).pipe(Effect.provide(layer))
  }),
)

it.effect("denies cross-directory and cross-workspace access to recovered requests", () =>
  Effect.gen(function* () {
    yield* park()
    for (const ref of [
      { directory: "/other" },
      {
        directory: "/project",
        workspaceID: Schema.decodeUnknownSync(Location.Ref)({ directory: "/project", workspaceID: "wrk_other" })
          .workspaceID,
      },
    ]) {
      const layer = yield* clients(ref.directory, ref.workspaceID)
      yield* Effect.gen(function* () {
        const permission = yield* Permission.Service
        expect(yield* permission.list()).toEqual([])
        expect(yield* permission.forSession(sessionID)).toEqual([])
        expect(yield* permission.get(requestID)).toBeUndefined()
        expect(yield* permission.reply({ requestID, reply: "once" }).pipe(Effect.flip)).toBeInstanceOf(
          Permission.NotFoundError,
        )
      }).pipe(Effect.provide(layer))
    }
  }),
)

it.effect("rolls back the decision and saved grant if creation of the authorized Question fails", () =>
  Effect.gen(function* () {
    const fixture = yield* park()
    const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
    yield* fixture.db.run(
      sql`CREATE TRIGGER reject_authorized_question BEFORE INSERT ON session_question BEGIN SELECT RAISE(ABORT, 'injected authorization failure'); END`,
    )
    const layer = yield* clients()
    yield* Effect.gen(function* () {
      const permission = yield* Permission.Service
      expect((yield* permission.reply({ requestID, reply: "always" }).pipe(Effect.exit))._tag).toBe("Failure")
      expect(yield* permission.list()).toHaveLength(1)
    }).pipe(Effect.provide(layer))
    expect(yield* fixture.db.select().from(PermissionTable)).toEqual([])
    expect(yield* fixture.db.select().from(SessionQuestionTable)).toEqual([])
    expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
  }),
)

for (const reply of ["once", "always", "reject"] as const) {
  it.effect(`replays ${reply} without Permission services, hooks, or commit callbacks`, () =>
    Effect.gen(function* () {
      const fixture = yield* park()
      const decision = {
        sessionID,
        assistantMessageID,
        generation: fixture.generation,
        callID: "call",
        requestID,
        reply,
      }
      yield* fixture.bus.publish(SessionEvent.PermissionResolution.Resolved, decision)
      const sequence = yield* Bus.latestSequence(fixture.db, sessionID)
      expect(
        (yield* fixture.bus.publish(SessionEvent.PermissionResolution.Resolved, decision).pipe(Effect.exit))._tag,
      ).toBe("Failure")
      expect(yield* Bus.latestSequence(fixture.db, sessionID)).toBe(sequence)
      const expectedPermissions = yield* fixture.db.select().from(SessionPermissionTable)
      const expectedQuestions = yield* fixture.db.select().from(SessionQuestionTable)
      const expectedGrants = yield* fixture.db.select().from(PermissionTable)
      const expectedMessage = yield* fixture.db
        .select({
          id: SessionMessageTable.id,
          data: SessionMessageTable.data,
          generation: SessionMessageTable.step_started_seq,
          seq: SessionMessageTable.seq,
        })
        .from(SessionMessageTable)
      const recorded = (yield* fixture.db.select().from(EventTable).orderBy(asc(EventTable.seq))).map((event) => ({
        id: event.id,
        aggregateID: event.aggregate_id,
        created: event.created,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))
      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const bus = yield* Bus.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        for (const event of recorded) {
          yield* bus.replay(event)
          yield* bus.replay(event)
        }
        expect(yield* db.select().from(SessionPermissionTable)).toEqual(expectedPermissions)
        expect(yield* db.select().from(SessionQuestionTable)).toEqual(expectedQuestions)
        expect(yield* db.select().from(PermissionTable)).toEqual(expectedGrants)
        expect(
          yield* db
            .select({
              id: SessionMessageTable.id,
              data: SessionMessageTable.data,
              generation: SessionMessageTable.step_started_seq,
              seq: SessionMessageTable.seq,
            })
            .from(SessionMessageTable),
        ).toEqual(expectedMessage)
      }).pipe(
        Effect.provide(
          Layer.fresh(
            AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]), [
              Database.node.replace(Database.configured()),
              Bus.node.replace(Bus.configured({ persist: true })),
            ]),
          ),
        ),
      )
    }),
  )
}
