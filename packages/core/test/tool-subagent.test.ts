import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Schema, Scope, Stream } from "effect"
import { AIError, InvalidRequestError, LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import path from "path"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { JobTable } from "@opencode/core/job/sql"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Permission } from "@opencode/core/permission"
import { SubagentTool } from "@opencode/core/tool/plugin/subagent"
import { Tool } from "@opencode/core/tool"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const childText = "child final response"
const completedOutput = (sessionID: Session.ID) =>
  `<subagent sessionID="${sessionID}" state="completed">\n${childText}\n</subagent>`
const childModel = Model.Ref.make({ id: Model.ID.make("child"), providerID: Provider.ID.make("test") })
const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })
const overrideModel = Model.Ref.make({
  id: Model.ID.make("override"),
  providerID: Provider.ID.make("test"),
  variant: Model.VariantID.make("fast"),
})
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const outputSessionID = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ sessionID: Session.ID }))(value).sessionID

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const completed = new Set<Session.ID>()
      const complete = Effect.fn("SubagentTest.complete")(function* (sessionID: Session.ID) {
        if (completed.has(sessionID)) return
        if ((yield* store.get(sessionID))?.title?.includes("fail")) {
          const error = new SessionRunnerModel.ModelNotSelectedError({ sessionID })
          yield* bus.publish(SessionEvent.Execution.Failed, {
            sessionID,
            error: { type: "model.unavailable", message: error.message },
          })
          return yield* error
        }
        completed.add(sessionID)
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: Agent.ID.make("reviewer"),
          model: childModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
        })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
          text: childText,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens,
        })
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: (sessionID) => complete(sessionID).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const subagentPluginSupervisor = makeLocationNode({
  name: "test/subagent-plugins",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* registerToolPlugin(SubagentTool.Plugin, {}, (name, callback) => hooks.register("tool", name, callback))
    }),
  ),
  deps: [
    Agent.node,
    Config.node,
    Model.node,
    Permission.node,
    Session.node,
    Job.node,
    SubagentJob.node,
    Tool.node,
    PluginHooks.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
])
const replacements = [
  SessionExecution.node.replace(executionNode),
  Global.node.replace(tempGlobalLayer),
  offlineModels,
] satisfies LayerNode.Replacements
const productionIt = testEffect(AppNodeBuilder.build(nodes, replacements))
const it = testEffect(
  AppNodeBuilder.build(nodes, [...replacements, PluginSupervisor.node.replace(subagentPluginSupervisor)]),
)
const liveExecution = (fallback: TestLLM.Response, extraReplacements: LayerNode.Replacements = []) => {
  const llm = TestLLM.testLayer({ fallback })
  return Layer.merge(
    llm,
    AppNodeBuilder.build(LayerNode.group([nodes, SessionRestart.node, SubagentJob.node]), [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      Watcher.node.replace(Watcher.configured({ enabled: false })),
      PluginSupervisor.node.replace(subagentPluginSupervisor),
      LayerNodePlatform.llmClient.replace(llm),
      SessionRunnerModel.node.replace(
        Layer.succeed(SessionRunnerModel.Service, {
          resolve: () =>
            Effect.succeed(
              SessionRunnerModel.resolved(
                LanguageModel.make({ id: "child", provider: "test", route: OpenAIChat.route }),
                {
                  capabilities: { tools: true, input: ["text"], output: ["text"] },
                  cost: [],
                  limit: { context: 200_000, output: 32_000 },
                },
              ),
            ),
        }),
      ),
      ...extraReplacements,
    ]),
  )
}
const completionIt = testEffect(liveExecution(TestLLM.text(childText, "completion")))

const subagentRow = (database: Database.Interface, childID: Session.ID) =>
  database.db.select().from(JobTable).where(eq(JobTable.child_session_id, childID)).get()

// Launches a background child of a fresh parent and collects the synthetic messages the parent receives.
const withBackgroundChild = <A, E, R>(
  callID: string,
  body: (child: {
    readonly id: Session.ID
    readonly parentID: Session.ID
    readonly sessions: Session.Interface
    readonly database: Database.Interface
    readonly llm: TestLLM.TestInterface
    readonly notifications: Queue.Queue<string>
    readonly completed: (text: string) => string
    readonly errored: (text: string) => string
    readonly settle: Effect.Effect<void>
  }) => Effect.Effect<A, E, R>,
  responses: readonly TestLLM.Response[] = [],
) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((dir) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const llm = yield* TestLLM.Test
        if (responses.length > 0) yield* llm.push(...responses)
        const parent = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
          model: parentModel,
          title: "Background child recipient",
        })
        yield* withSubagent(parent.location)
        const locations = yield* LocationServiceMap.Service
        const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
        const bus = yield* Bus.Service
        const notifications = yield* Queue.unbounded<string>()
        yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
          event.data.sessionID === parent.id && event.data.item.type === "synthetic"
            ? Queue.offer(notifications, event.data.item.payload.text).pipe(Effect.asVoid)
            : Effect.void,
        )
        const result = yield* executeTool(registry, {
          sessionID: parent.id,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: callID,
            name: SubagentTool.name,
            input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
          },
        })
        const id = outputSessionID(result.metadata)
        return yield* body({
          id,
          parentID: parent.id,
          sessions,
          database,
          llm,
          notifications,
          completed: (text) =>
            `<subagent sessionID="${id}" state="completed" description="background review">\n${text}\n</subagent>`,
          errored: (text) =>
            `<subagent sessionID="${id}" state="error" description="background review">\n${text}\n</subagent>`,
          settle: Effect.all([sessions.wait(id), sessions.wait(parent.id)], { discard: true }).pipe(Effect.orDie),
        })
      }),
    ),
  )

const withSubagent = (location: Location.Ref) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
    yield* Provider.Service.use((providers) =>
      providers.transform((editor) => {
        editor.models.update(overrideModel.providerID, overrideModel.id, (model) => {
          model.variants = [{ id: Model.VariantID.make("fast") }]
        })
        editor.models.update(Provider.ID.make("test"), Model.ID.make("plain"), () => {})
        editor.models.update(Provider.ID.make("test"), Model.ID.make("painter"), (model) => {
          model.type = "image"
        })
        editor.models.update(Provider.ID.make("test"), Model.ID.make("classifier"), (model) => {
          model.type = "decision"
        })
      }),
    ).pipe(Effect.provide(locations.get(location)))
    yield* Agent.Service.use((agents) =>
      agents.transform((editor) => {
        // The caller identity used by executeTool; subagent permission asserts against it.
        editor.update(toolIdentity.agent, (agent) => {
          agent.mode = "primary"
          agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
        })
        editor.update(Agent.ID.make("reviewer"), (agent) => {
          agent.mode = "subagent"
          agent.model = childModel
        })
        editor.update(Agent.ID.make("fallback"), (agent) => {
          agent.mode = "subagent"
        })
        editor.update(Agent.ID.make("primary"), (agent) => {
          agent.mode = "primary"
        })
      }),
    ).pipe(Effect.provide(locations.get(location)))
  })

describe("SubagentTool", () => {
  completionIt.live("admits one durable completion across live delivery and restart replay", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
            model: parentModel,
            title: "Completion recipient",
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const jobs = yield* Job.Service
          const database = yield* Database.Service
          const bus = yield* Bus.Service
          const admitted = yield* Deferred.make<SessionMessage.ID>()
          const notifications: SessionMessage.ID[] = []
          yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
            Effect.gen(function* () {
              if (event.data.sessionID !== parent.id || event.data.item.type !== "synthetic") return
              notifications.push(event.data.inboxID)
              yield* Deferred.succeed(admitted, event.data.inboxID)
            }),
          )

          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-completion-replay",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
            },
          })
          const childID = outputSessionID(result.metadata)
          const noticeID = yield* Deferred.await(admitted)
          yield* jobs.pendingBackground.pipe(Effect.repeat({ until: (pending) => pending.length === 0 }))
          yield* sessions.wait(parent.id)
          const messages = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(messages).toEqual([
            expect.objectContaining({
              id: noticeID,
              description: "background review",
              text: `<subagent sessionID="${childID}" state="completed" description="background review">\n${childText}\n</subagent>`,
              metadata: {
                source: "subagent",
                childID,
                agent: "reviewer",
                state: "completed",
              },
            }),
          ])
          const saved = yield* subagentRow(database, childID)
          expect(saved).toMatchObject({
            session_id: parent.id,
            child_session_id: childID,
            kind: "subagent",
            pending: false,
            reported: expect.stringMatching(/^msg_/),
            dirty: false,
          })

          // Reproduce a crash after synthetic admission commits, before the saved marker advances.
          yield* database.db
            .update(JobTable)
            .set({ reported: null, dirty: true })
            .where(eq(JobTable.child_session_id, childID))
            .run()
          const restart = yield* SessionRestart.Service
          yield* restart.resumeSuspendedSessions
          yield* sessions.wait(parent.id)
          expect(notifications).toEqual([noticeID])
          expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
            messages,
          )
          expect(yield* subagentRow(database, childID)).toMatchObject({
            pending: false,
            reported: saved?.reported,
            dirty: false,
          })
          expect(yield* jobs.pendingBackground).toEqual([])
        }),
      ),
    ),
  )

  for (const background of [true, false]) {
    completionIt.live(
      `notifies the parent when a ${background ? "background" : "foreground"} child continues after its initial report`,
      () =>
        Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
        ).pipe(
          Effect.flatMap((dir) =>
            Effect.gen(function* () {
              const sessions = yield* Session.Service
              const llm = yield* TestLLM.Test
              yield* llm.push(TestLLM.text("Interim update.", "interim"))
              const parent = yield* sessions.create({
                location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
                model: parentModel,
                title: "Continuation recipient",
              })
              yield* withSubagent(parent.location)
              const locations = yield* LocationServiceMap.Service
              const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
              const bus = yield* Bus.Service
              const notifications = yield* Queue.unbounded<string>()
              yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
                event.data.sessionID === parent.id && event.data.item.type === "synthetic"
                  ? Queue.offer(notifications, event.data.item.payload.text).pipe(Effect.asVoid)
                  : Effect.void,
              )

              const result = yield* executeTool(registry, {
                sessionID: parent.id,
                ...toolIdentity,
                call: {
                  type: "tool-call",
                  id: `call-continuation-${background}`,
                  name: SubagentTool.name,
                  input: {
                    agent: "reviewer",
                    description: "background review",
                    prompt: "review",
                    background,
                  },
                },
              })
              const childID = outputSessionID(result.metadata)
              const framed = (text: string) =>
                `<subagent sessionID="${childID}" state="completed" description="background review">\n${text}\n</subagent>`

              if (background) {
                expect(yield* Queue.take(notifications)).toBe(framed("Interim update."))
              }
              if (!background) {
                expect(result.content).toEqual([
                  {
                    type: "text",
                    text: `<subagent sessionID="${childID}" state="completed">\nInterim update.\n</subagent>`,
                  },
                ])
              }
              yield* Effect.all([sessions.wait(childID), sessions.wait(parent.id)], { discard: true })
              expect(yield* Queue.size(notifications)).toBe(0)

              // Something other than the subagent tool (a plugin or background shell) continues the child.
              yield* sessions.synthetic({ sessionID: childID, text: "Continue from where you left off." })
              const followUp = yield* Queue.take(notifications).pipe(Effect.timeoutOption("3 seconds"))
              expect(Option.getOrUndefined(followUp)).toBe(framed(childText))
              yield* Effect.all([sessions.wait(childID), sessions.wait(parent.id)], { discard: true })
              expect(yield* Queue.size(notifications)).toBe(0)
            }),
          ),
        ),
    )
  }

  completionIt.live("does not wake the parent on empty successes, then reports the later text turn", () =>
    withBackgroundChild(
      "call-empty-continuations",
      (child) =>
        Effect.gen(function* () {
          // Neither the initial empty step nor empty plugin retries wake the parent.
          yield* child.settle
          expect(yield* Queue.size(child.notifications)).toBe(0)

          for (const _ of [1, 2]) {
            yield* child.llm.push(TestLLM.stop())
            yield* child.sessions.synthetic({ sessionID: child.id, text: "Continue from where you left off." })
            yield* child.settle
          }
          expect(yield* Queue.size(child.notifications)).toBe(0)

          yield* child.sessions.synthetic({ sessionID: child.id, text: "Continue from where you left off." })
          const followUp = yield* Queue.take(child.notifications).pipe(Effect.timeoutOption("3 seconds"))
          expect(Option.getOrUndefined(followUp)).toBe(child.completed(childText))
          yield* child.settle
          expect(yield* Queue.size(child.notifications)).toBe(0)
        }),
      [TestLLM.stop()],
    ),
  )

  completionIt.live("reports a failed continuation to the parent", () =>
    withBackgroundChild("call-failed-continuation", (child) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(child.notifications)).toBe(child.completed(childText))
        yield* child.settle

        yield* child.llm.push(
          Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "provider boom" }) })),
        )
        yield* child.sessions.synthetic({ sessionID: child.id, text: "Continue from where you left off." })
        const failed = yield* Queue.take(child.notifications).pipe(Effect.timeoutOption("3 seconds"))
        expect(Option.getOrUndefined(failed)).toBe(child.errored("provider boom"))
        yield* child.settle
        expect(yield* Queue.size(child.notifications)).toBe(0)
      }),
    ),
  )

  completionIt.live("does not notify the parent when a continuation is interrupted", () =>
    withBackgroundChild("call-interrupted-continuation", (child) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(child.notifications)).toBe(child.completed(childText))

        // The parent's own turn after the notification must not take the scripted response.
        yield* child.settle
        const requests = (yield* child.llm.requests()).length
        yield* child.llm.push(Stream.never)
        yield* child.sessions.synthetic({ sessionID: child.id, text: "Continue from where you left off." })
        yield* child.llm.wait(requests + 1)
        yield* child.sessions.interrupt(child.id)
        yield* child.settle
        expect(yield* Queue.size(child.notifications)).toBe(0)
      }),
    ),
  )

  completionIt.live("does not notify a parent being deleted while its child continues and cleans up markers", () =>
    withBackgroundChild("call-deleted-parent", (child) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(child.notifications)).toBe(child.completed(childText))
        expect(yield* subagentRow(child.database, child.id)).toBeDefined()

        // The parent's own turn after the notification must not take the scripted response.
        yield* child.settle
        const requests = (yield* child.llm.requests()).length
        yield* child.llm.push(Stream.never)
        yield* child.sessions.synthetic({ sessionID: child.id, text: "Continue from where you left off." })
        yield* child.llm.wait(requests + 1)
        yield* child.sessions.remove(child.parentID)
        expect(yield* Queue.size(child.notifications)).toBe(0)
        expect(Exit.isFailure(yield* child.sessions.get(child.id).pipe(Effect.exit))).toBe(true)
        expect(yield* subagentRow(child.database, child.id)).toBeUndefined()
      }),
    ),
  )

  completionIt.live("cleans up the saved marker when the child session is deleted", () =>
    withBackgroundChild("call-deleted-child", (child) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(child.notifications)).toBe(child.completed(childText))
        yield* child.settle
        expect(yield* subagentRow(child.database, child.id)).toBeDefined()

        yield* child.sessions.remove(child.id)
        expect(yield* subagentRow(child.database, child.id)).toBeUndefined()
      }),
    ),
  )

  completionIt.live("still notifies the parent when a user steers a running background child", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const llm = yield* TestLLM.Test
          const gate = yield* llm.gate()
          const parent = yield* sessions.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
            model: parentModel,
            title: "Steered child recipient",
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const bus = yield* Bus.Service
          const notifications = yield* Queue.unbounded<string>()
          yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
            event.data.sessionID === parent.id && event.data.item.type === "synthetic"
              ? Queue.offer(notifications, event.data.item.payload.text).pipe(Effect.asVoid)
              : Effect.void,
          )

          const launched = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-steered-child",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
            },
          })
          const childID = outputSessionID(launched.metadata)
          yield* gate.started
          // Steering into a turn the parent started keeps that turn owned by the subagent request.
          yield* sessions.prompt({ sessionID: childID, text: "Also check edge cases." })
          yield* llm.push(TestLLM.text("Steered final answer.", "steered"))
          yield* gate.release

          const delivered = yield* Queue.take(notifications).pipe(Effect.timeoutOption("3 seconds"))
          expect(Option.getOrUndefined(delivered)).toBe(
            `<subagent sessionID="${childID}" state="completed" description="background review">\nSteered final answer.\n</subagent>`,
          )
          yield* Effect.all([sessions.wait(childID), sessions.wait(parent.id)], { discard: true })
          expect(yield* Queue.size(notifications)).toBe(0)
        }),
      ),
    ),
  )

  completionIt.live("does not notify the parent when someone prompts a child directly", () =>
    withBackgroundChild("call-direct-prompt", (child) =>
      Effect.gen(function* () {
        expect(yield* Queue.take(child.notifications)).toContain(childText)
        yield* child.settle

        yield* child.sessions.prompt({ sessionID: child.id, text: "One more question." })
        yield* child.settle
        expect(yield* Queue.size(child.notifications)).toBe(0)

        // Later subagent continuations still report to the parent.
        yield* child.llm.push(TestLLM.text("Back on task.", "resumed"))
        yield* child.sessions.synthetic({ sessionID: child.id, text: "Background shell finished." })
        const followUp = yield* Queue.take(child.notifications).pipe(Effect.timeoutOption("3 seconds"))
        expect(Option.getOrUndefined(followUp)).toBe(child.completed("Back on task."))
      }),
    ),
  )

  completionIt.live("delivers multiple child turns in order without losing any", () =>
    withBackgroundChild(
      "call-ordered-turns",
      (child) =>
        Effect.gen(function* () {
          expect(yield* Queue.take(child.notifications)).toBe(child.completed("turn one"))
          yield* child.settle

          // Pause the parent so both child follow-ups land and queue in order.
          yield* child.llm.push(TestLLM.text("turn two", "t2"))
          const second = yield* child.sessions.synthetic({ sessionID: child.id, text: "Step two." })
          expect(yield* Queue.take(child.notifications)).toBe(child.completed("turn two"))
          yield* child.settle

          // Reverting turn two re-anchors `job.reported` to turn one so later turns still deliver.
          yield* child.sessions.revert.stage({ sessionID: child.id, messageID: second.id, files: false })
          yield* child.llm.push(TestLLM.text("turn three", "t3"))
          yield* child.sessions.prompt({
            sessionID: child.id,
            metadata: { source: "subagent" },
            text: "Step three.",
          })
          expect(yield* Queue.take(child.notifications)).toBe(child.completed("turn three"))
          yield* child.settle
          expect(yield* Queue.size(child.notifications)).toBe(0)
        }),
      [TestLLM.text("turn one", "t1")],
    ),
  )

  testEffect(Layer.empty).live(
    "preserves the saved marker across a server restart without repeating reported turns",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((dir) =>
          Effect.gen(function* () {
            const dbPath = path.join(dir.path, "restart.db")
            const projectDir = path.join(dir.path, "project")
            yield* Effect.promise(() => Bun.write(path.join(projectDir, ".keep"), ""))
            const boot = (fallback: string) =>
              liveExecution(TestLLM.text(fallback, "boot"), [
                Database.node.replace(Database.configured({ path: dbPath })),
              ])

            // First server process: background child completes turn 1 and reports it.
            const firstScope = yield* Scope.make()
            const first = yield* Layer.buildWithScope(boot("before restart"), firstScope)
            const { parentID, childID } = yield* Effect.gen(function* () {
              const sessions = yield* Session.Service
              const bus = yield* Bus.Service
              const locations = yield* LocationServiceMap.Service
              const parent = yield* sessions.create({
                location: Location.Ref.make({ directory: AbsolutePath.make(projectDir) }),
                model: parentModel,
                title: "Restart parent",
              })
              yield* withSubagent(parent.location)
              const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
              const notices = yield* Queue.unbounded<string>()
              yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
                event.data.sessionID === parent.id && event.data.item.type === "synthetic"
                  ? Queue.offer(notices, event.data.item.payload.text).pipe(Effect.asVoid)
                  : Effect.void,
              )
              const launched = yield* executeTool(registry, {
                sessionID: parent.id,
                ...toolIdentity,
                call: {
                  type: "tool-call",
                  id: "call-across-restart",
                  name: SubagentTool.name,
                  input: { agent: "reviewer", description: "restart review", prompt: "review", background: true },
                },
              })
              const id = outputSessionID(launched.metadata)
              expect(yield* Queue.take(notices)).toBe(
                `<subagent sessionID="${id}" state="completed" description="restart review">\nbefore restart\n</subagent>`,
              )
              yield* Effect.all([sessions.wait(id), sessions.wait(parent.id)], { discard: true })
              return { parentID: parent.id, childID: id }
            }).pipe(Effect.provide(first))
            yield* Scope.close(firstScope, Exit.void)

            // Second server process on the same SQLite database: turn 1 is not repeated, and turn 2 reports cleanly.
            const secondScope = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(secondScope, Exit.void))
            const second = yield* Layer.buildWithScope(boot("after restart"), secondScope)
            yield* Effect.gen(function* () {
              const sessions = yield* Session.Service
              const restart = yield* SessionRestart.Service
              const database = yield* Database.Service
              const bus = yield* Bus.Service
              yield* withSubagent(Location.Ref.make({ directory: AbsolutePath.make(projectDir) }))
              const notices = yield* Queue.unbounded<string>()
              yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
                event.data.sessionID === parentID && event.data.item.type === "synthetic"
                  ? Queue.offer(notices, event.data.item.payload.text).pipe(Effect.asVoid)
                  : Effect.void,
              )
              yield* restart.resumeSuspendedSessions
              expect(yield* Queue.size(notices)).toBe(0)

              yield* sessions.synthetic({ sessionID: childID, text: "Continue after server restart." })
              const afterRestart = yield* Queue.take(notices).pipe(Effect.timeoutOption("3 seconds"))
              expect(Option.getOrUndefined(afterRestart)).toBe(
                `<subagent sessionID="${childID}" state="completed" description="restart review">\nafter restart\n</subagent>`,
              )
              yield* Effect.all([sessions.wait(childID), sessions.wait(parentID)], { discard: true })
              expect(yield* Queue.size(notices)).toBe(0)

              // Simulate a crash before two completed child turns were reported: catch-up reconciles both in order.
              const llm = yield* TestLLM.Test
              const reportedBeforeCatchUp = (yield* subagentRow(database, childID))?.reported ?? null
              yield* llm.push(TestLLM.text("missed one", "m1"))
              yield* sessions.synthetic({ sessionID: childID, text: "First missed turn." })
              expect(yield* Queue.take(notices)).toContain("missed one")
              yield* Effect.all([sessions.wait(childID), sessions.wait(parentID)], { discard: true })

              yield* llm.push(TestLLM.text("missed two", "m2"))
              yield* sessions.synthetic({ sessionID: childID, text: "Second missed turn." })
              expect(yield* Queue.take(notices)).toContain("missed two")
              yield* Effect.all([sessions.wait(childID), sessions.wait(parentID)], { discard: true })

              // Rewinding the marker before those two turns reconciles both idempotently on restart without duplicates.
              yield* database.db
                .update(JobTable)
                .set({ reported: reportedBeforeCatchUp, dirty: true })
                .where(eq(JobTable.child_session_id, childID))
                .run()
              yield* restart.resumeSuspendedSessions
              expect(yield* Queue.size(notices)).toBe(0)
              expect((yield* subagentRow(database, childID))?.dirty).toBe(false)
            }).pipe(Effect.provide(second))
          }),
        ),
      ),
  )

  productionIt.live("registers globally while resolving agents from the caller location", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const session = yield* Session.Service
          const parent = yield* session.create({ location })
          yield* withSubagent(parent.location)

          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          expect((yield* registry.snapshot()).definitions.map((tool) => tool.name)).toContain(SubagentTool.name)
          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-primary",
                name: SubagentTool.name,
                input: { agent: "primary", description: "primary", prompt: "should fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: { type: "tool.execution", message: "Agent primary cannot run as a subagent" },
          })
        }),
      ),
    ),
  )

  it.live("prevents subagents from launching subagents by default", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ location })
          const parent = yield* sessions.create({ parentID: root.id, title: "parent" })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-nested-subagent",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "nested", prompt: "should fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("Subagent depth limit reached (1)"),
            },
          })
          expect((yield* sessions.list({ parentID: parent.id })).data).toHaveLength(0)
        }),
      ),
    ),
  )

  it.live("allows nested subagents up to the configured depth", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(path.join(dir.path, "opencode.json"), JSON.stringify({ experimental: { subagent_depth: 2 } })),
          )
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const root = yield* sessions.create({ location })
          const parent = yield* sessions.create({ parentID: root.id, title: "parent", model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-configured-nested-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "nested", prompt: "should run" },
            },
          })

          expect(settled).toMatchObject({
            status: "completed",
            metadata: { status: "completed" },
            content: [{ type: "text", text: expect.stringContaining(childText) }],
          })
          expect(settled.metadata).toEqual({
            sessionID: outputSessionID(settled.metadata),
            status: "completed",
          })
          expect((yield* sessions.get(outputSessionID(settled.metadata))).parentID).toBe(parent.id)
        }),
      ),
    ),
  )

  it.live("runs a foreground child session and returns the final assistant text", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const progress: Tool.Metadata[] = []

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            progress: (update) => Effect.sync(() => progress.push(update)),
            call: {
              type: "tool-call",
              id: "call-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "review", prompt: "review this", model: "", sessionID: "" },
            },
          })

          expect(settled).toMatchObject({
            status: "completed",
            metadata: { status: "completed" },
            content: [{ type: "text", text: expect.stringContaining(childText) }],
          })
          const child = yield* sessions.get(outputSessionID(settled.metadata))
          expect(settled.content).toEqual([{ type: "text", text: completedOutput(child.id) }])
          expect(settled.metadata).toEqual({ sessionID: child.id, status: "completed" })
          expect(progress[0]).toEqual({ sessionID: child.id, status: "running" })
          expect(child).toMatchObject({
            parentID: parent.id,
            location: parent.location,
            agent: "reviewer",
            model: childModel,
          })
          expect((yield* sessions.inbox(child.id)).find((message) => message.type === "user")?.payload.text).toBe(
            "You are a subagent spawned by another session.\nreview this",
          )

          const fallback = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-fallback",
              name: SubagentTool.name,
              input: { agent: "fallback", description: "fallback", prompt: "fallback" },
            },
          })
          const fallbackChild = yield* sessions.get(outputSessionID(fallback.metadata))
          expect(fallbackChild).toMatchObject({ parentID: parent.id, model: parentModel })
        }),
      ),
    ),
  )

  it.live("continues an existing child session", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          const first = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-first",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "review", prompt: "review this" },
            },
          })
          const childID = outputSessionID(first.metadata)
          const second = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-subagent-second",
              name: SubagentTool.name,
              input: {
                agent: "reviewer",
                description: "follow up",
                prompt: "continue this",
                sessionID: childID,
                model: "",
              },
            },
          })

          expect(outputSessionID(second.metadata)).toBe(childID)
          expect((yield* sessions.list({ parentID: parent.id })).data).toHaveLength(1)
          expect((yield* sessions.get(childID)).title).toBe("review")
          expect(
            (yield* sessions.inbox(childID)).flatMap((message) =>
              message.type === "user" ? [message.payload.text] : [],
            ),
          ).toEqual(["You are a subagent spawned by another session.\nreview this", "continue this"])
          expect(second.content).toEqual([{ type: "text", text: completedOutput(childID) }])
        }),
      ),
    ),
  )

  it.live("steers a running child session in the background", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          const child = yield* sessions.create({
            parentID: parent.id,
            title: "review",
            agent: Agent.ID.make("reviewer"),
            model: childModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const jobs = yield* Job.Service
          yield* jobs.start({ id: child.id, type: SubagentTool.name, run: Effect.never })

          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-running-subagent",
              name: SubagentTool.name,
              input: {
                agent: "reviewer",
                description: "follow up",
                prompt: "continue while running",
                sessionID: child.id,
                background: true,
              },
            },
          })

          expect(result).toMatchObject({
            status: "completed",
            metadata: { sessionID: child.id, status: "running" },
          })
          expect((yield* sessions.inbox(child.id)).find((message) => message.type === "user")?.payload.text).toBe(
            "continue while running",
          )
          expect((yield* jobs.get(child.id))?.status).toBe("running")
          yield* jobs.cancel(child.id)
        }),
      ),
    ),
  )

  it.live("follow-ups to a running background child return immediately and notify once", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          const child = yield* sessions.create({
            parentID: parent.id,
            title: "review",
            agent: Agent.ID.make("reviewer"),
            model: childModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const jobs = yield* Job.Service
          const bus = yield* Bus.Service
          const gate = yield* Deferred.make<void>()
          yield* jobs.start({
            id: child.id,
            type: SubagentTool.name,
            run: Deferred.await(gate).pipe(Effect.andThen(sessions.resume(child.id)), Effect.as("done")),
          })
          const notified = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )
          const followUp = (id: string, input: { background?: boolean }) =>
            executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id,
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "follow up", prompt: id, sessionID: child.id, ...input },
              },
            }).pipe(Effect.timeout("2 seconds"))

          const launched = yield* followUp("call-launch", { background: true })
          const steered = yield* followUp("call-steer", { background: true })
          const unflagged = yield* followUp("call-steer-foreground", {})
          ;[launched, steered, unflagged].forEach((result) =>
            expect(result).toMatchObject({ metadata: { sessionID: child.id, status: "running" } }),
          )

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.join(notified).pipe(Effect.timeout("2 seconds"))
          expect((yield* sessions.inbox(parent.id)).filter((item) => item.type === "synthetic")).toHaveLength(1)
        }),
      ),
    ),
  )

  it.live("rejects unrelated children and switches agents on continuation", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          const otherParent = yield* sessions.create({ location, model: parentModel })
          const unrelated = yield* sessions.create({
            parentID: otherParent.id,
            title: "other review",
            agent: Agent.ID.make("reviewer"),
          })
          const switched = yield* sessions.create({
            parentID: parent.id,
            title: "fallback review",
            agent: Agent.ID.make("fallback"),
            model: parentModel,
          })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const call = (sessionID: Session.ID, id: string, agent = "reviewer") =>
            executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call" as const,
                id,
                name: SubagentTool.name,
                input: { agent, description: "follow up", prompt: "continue", sessionID },
              },
            })

          const missing = Session.ID.create()
          expect(yield* call(missing, "call-missing-child")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Subagent session not found: ${missing}`,
            },
          })
          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-malformed-child-id",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "follow up", prompt: "continue", sessionID: "placeholder" },
              },
            }),
          ).toMatchObject({
            status: "error",
            error: { message: expect.stringContaining('sessionID: Expected a string starting with "ses"') },
          })
          expect(yield* call(parent.id, "call-parent-id")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Session ${parent.id} is not a child of the current session`,
            },
          })
          expect(yield* call(unrelated.id, "call-unrelated-child")).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: `Session ${unrelated.id} is not a child of the current session`,
            },
          })
          expect(yield* call(switched.id, "call-switched-child")).toMatchObject({
            status: "completed",
            metadata: { sessionID: switched.id, status: "completed" },
          })
          expect(yield* sessions.get(switched.id)).toMatchObject({
            agent: "reviewer",
            model: childModel,
          })
          // Switching to an agent without a configured model keeps the child's current model.
          expect(yield* call(switched.id, "call-modelless-switch", "fallback")).toMatchObject({
            status: "completed",
            metadata: { sessionID: switched.id, status: "completed" },
          })
          expect(yield* sessions.get(switched.id)).toMatchObject({
            agent: "fallback",
            model: childModel,
          })
        }),
      ),
    ),
  )

  it.live("runs the child on an explicitly requested model", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location, model: parentModel })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const call = (id: string, input: Record<string, unknown>) =>
            executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call" as const,
                id,
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "review", prompt: "review this", ...input },
              },
            })

          // The requested model beats the agent's configured model.
          const spawned = yield* call("call-override", { model: "test/override#fast", sessionID: "" })
          expect(spawned).toMatchObject({ status: "completed", metadata: { status: "completed" } })
          const child = yield* sessions.get(outputSessionID(spawned.metadata))
          expect(child).toMatchObject({ agent: "reviewer", model: overrideModel })

          // Continuing with a model switches the existing child even when the agent is unchanged.
          const continued = yield* call("call-override-continue", { sessionID: child.id, model: "test/override" })
          expect(continued).toMatchObject({ status: "completed", metadata: { sessionID: child.id } })
          expect((yield* sessions.get(child.id)).model).toEqual({
            id: overrideModel.id,
            providerID: overrideModel.providerID,
            variant: Model.VariantID.make("default"),
          })

          const failures = [
            ["not-a-ref", 'Invalid model "not-a-ref". Use "providerID/modelID" or "providerID/modelID#variant".'],
            ["test/missing", 'Model "test/missing" is not available. Use the models tool to see what is available.'],
            ["test/override#slow", 'Variant "slow" is not available for "test/override". Available: fast.'],
            ["test/plain#high", 'Model "test/plain" has no variants. Omit the variant.'],
            [
              "test/painter",
              'Model "test/painter" is an image model; subagents need a chat model. Use the models tool to find one.',
            ],
            [
              "test/classifier",
              'Model "test/classifier" is a decision model; subagents need a chat model. Use the models tool to find one.',
            ],
          ] as const
          for (const [model, message] of failures) {
            expect(yield* call(`call-${model}`, { model })).toEqual({
              status: "error",
              error: { type: "tool.execution", message },
            })
          }
        }),
      ),
    ),
  )

  it.live("returns child runner failures as tool errors", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))

          expect(
            yield* executeTool(registry, {
              sessionID: parent.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-subagent-failure",
                name: SubagentTool.name,
                input: { agent: "reviewer", description: "fail review", prompt: "please fail" },
              },
            }),
          ).toEqual({
            status: "error",
            error: {
              type: "tool.execution",
              message: expect.stringContaining("No model is available for session"),
            },
          })
        }),
      ),
    ),
  )

  it.live("notifies once when background work completes", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const location = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
          const sessions = yield* Session.Service
          const parent = yield* sessions.create({ location })
          yield* withSubagent(parent.location)
          const locations = yield* LocationServiceMap.Service
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const bus = yield* Bus.Service
          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === parent.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          const settled = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-background-subagent",
              name: SubagentTool.name,
              input: { agent: "reviewer", description: "background review", prompt: "review", background: true },
            },
          })
          const childID = outputSessionID(settled.metadata)
          expect(settled.metadata).toMatchObject({
            status: "running",
          })
          expect(settled.metadata).toEqual({ sessionID: childID, status: "running" })
          expect(settled.content).toEqual([{ type: "text", text: expect.stringContaining(`sessionID: ${childID}`) }])

          const admission = Array.from(yield* Fiber.join(admitted))[0]
          expect(admission?.data.item.type).toBe("synthetic")
          if (admission?.data.item.type !== "synthetic") return yield* Effect.die("Expected synthetic inbox item")
          expect(admission?.data.item.payload.text).toContain(`<subagent sessionID="${childID}" state="completed"`)
          expect(admission?.data.item.payload).toMatchObject({
            description: "background review",
            metadata: {
              source: "subagent",
              childID,
              agent: "reviewer",
              state: "completed",
            },
          })
          const database = yield* Database.Service
          yield* SessionInbox.promote(database.db, bus, parent.id, "steer")
          const synthetic = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          expect(synthetic[0]?.text).toContain(`<subagent sessionID="${childID}" state="completed"`)
          expect(synthetic[0]?.text).toContain(childText)
        }),
      ),
    ),
  )
})
