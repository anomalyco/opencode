import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schedule, Schema, Stream } from "effect"
import { LanguageModel } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { TestLLM } from "@opencode-ai/ai/testing"
import path from "path"
import { Money } from "@opencode-ai/schema/money"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Agent } from "@opencode-ai/core/agent"
import { Job } from "@opencode-ai/core/job"
import { KV } from "@opencode-ai/core/kv"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Permission } from "@opencode-ai/core/permission"
import { SubagentOutcome } from "@opencode-ai/core/session/subagent-outcome"
import { SubagentJob } from "@opencode-ai/core/session/subagent-job"
import { SubagentTool } from "@opencode-ai/core/tool/plugin/subagent"
import { Tool } from "@opencode-ai/core/tool"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const childText = "child final response"
const completedOutput = (sessionID: Session.ID) =>
  `<subagent sessionID="${sessionID}" state="completed">\n${childText}\n</subagent>`
const childModel = Model.Ref.make({ id: Model.ID.make("child"), providerID: Provider.ID.make("test") })
const parentModel = Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") })
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
          yield* new SessionRunnerModel.ModelNotSelectedError({ sessionID })
          return
        }
        completed.add(sessionID)
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: Agent.ID.make("reviewer"),
          model: childModel,
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
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: (sessionID) => complete(sessionID).pipe(Effect.as({ type: "succeeded" as const })),
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
  layer: Layer.effectDiscard(registerToolPlugin(SubagentTool.Plugin)),
  deps: [Agent.node, Config.node, Permission.node, Session.node, Job.node, Tool.node],
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
// Merged back in so tests can drive the child's model through TestLLM.Test.
const completionLLM = TestLLM.testLayer({ fallback: TestLLM.text(childText, "completion") })
const completionIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([nodes, SessionRestart.node, KV.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    PluginSupervisor.node.replace(subagentPluginSupervisor),
    LayerNodePlatform.llmClient.replace(completionLLM),
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
  ]).pipe(Layer.provideMerge(completionLLM)),
)

const withSubagent = (location: Location.Ref) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(location)))
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

// A parent with a registry, plus one child whose first model request never completes.
const hangingChild = Effect.fn(function* (title: string, callID: string, input?: { background?: boolean }) {
  const dir = yield* tmpdirScoped()
  const sessions = yield* Session.Service
  const parent = yield* sessions.create({
    location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
    model: parentModel,
    title,
  })
  yield* withSubagent(parent.location)
  const locations = yield* LocationServiceMap.Service
  const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
  const llm = yield* TestLLM.Test
  yield* llm.push(TestLLM.hangAfter())
  const running = yield* Deferred.make<Session.ID>()
  const jobs = yield* Job.Service
  const bus = yield* Bus.Service
  const launches: Array<Job.Info | undefined> = []
  yield* bus.project(SessionEvent.Execution.Started, (event) =>
    jobs.get(event.data.sessionID).pipe(Effect.tap((job) => Effect.sync(() => void launches.push(job)))),
  )
  const call = yield* executeTool(registry, {
    sessionID: parent.id,
    ...toolIdentity,
    progress: (update) => Deferred.succeed(running, outputSessionID(update)).pipe(Effect.asVoid),
    call: {
      type: "tool-call",
      id: callID,
      name: SubagentTool.name,
      input: { agent: "reviewer", description: title, prompt: "review", ...input },
    },
  }).pipe(Effect.forkScoped)
  const childID = yield* Deferred.await(running)
  yield* llm.wait(1)
  // Both foreground and background new children have a Job before execution begins.
  expect(launches).toMatchObject([{ id: childID, status: "running" }])
  yield* jobs
    .get(childID)
    .pipe(
      Effect.repeat({ until: (info) => info?.status === "running", schedule: Schedule.spaced("5 millis") }),
      Effect.timeout("5 seconds"),
    )
  return { parent, registry, llm, call, childID }
})

describe("SubagentTool", () => {
  completionIt.live("uses the original job metadata when a joining call backgrounds the child", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const subagents = yield* SubagentJob.make
      const parent = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make(dir.path) }),
        model: parentModel,
      })
      const child = yield* sessions.create({ parentID: parent.id, model: childModel })
      const completed = yield* Deferred.make<Job.Outcome>()
      const recovery = {
        kind: "subagent" as const,
        parentSessionID: parent.id,
        childSessionID: child.id,
        agent: "reviewer",
        description: "Original review",
      }
      yield* jobs.start({ id: child.id, type: "subagent", recovery, run: Deferred.await(completed) })
      const joined = yield* subagents.start({ ...recovery, agent: "explorer", description: "Follow-up review" })
      expect(joined.recovery).toEqual(recovery)
      yield* subagents.background(child.id)
      expect(yield* jobs.pendingBackground).toMatchObject([{ recovery }])
      // A stopped result keeps the notice pending, making the actual live admission inspectable.
      yield* Deferred.succeed(completed, { kind: "subagent", status: "interrupted" })
      yield* jobs.pendingBackground.pipe(
        Effect.repeat({ until: (pending) => pending.length === 0, schedule: Schedule.spaced("5 millis") }),
        Effect.timeout("5 seconds"),
      )
      expect(yield* sessions.inbox(parent.id)).toMatchObject([
        { payload: { description: recovery.description, metadata: { agent: recovery.agent, state: "stopped" } } },
      ])
    }),
  )

  completionIt.live("answers a user stop of a foreground child as a stopped result the parent can continue", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const child = yield* hangingChild("foreground review", "call-user-stopped-subagent")

      expect(yield* sessions.interrupt(child.childID)).toBeTrue()
      yield* sessions.wait(child.childID)
      expect(yield* Fiber.join(child.call)).toEqual({
        status: "completed",
        output: { sessionID: child.childID, status: "stopped", output: SubagentOutcome.stopped },
        content: [
          {
            type: "text",
            text: `<subagent sessionID="${child.childID}" state="stopped">\n${SubagentOutcome.stopped}\n</subagent>`,
          },
        ],
        metadata: { sessionID: child.childID, status: "stopped" },
      })
      expect(yield* jobs.get(child.childID)).toMatchObject({
        status: "completed",
        result: { kind: "subagent", status: "interrupted" },
      })
      expect(yield* child.llm.requests()).toHaveLength(1)

      // Explicit continuation is a fresh job generation with its own outcome.
      const resumed = yield* executeTool(child.registry, {
        sessionID: child.parent.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-explicitly-resumed-subagent",
          name: SubagentTool.name,
          input: { agent: "reviewer", description: "continued review", prompt: "continue", sessionID: child.childID },
        },
      })
      expect(resumed).toMatchObject({
        status: "completed",
        content: [{ type: "text", text: completedOutput(child.childID) }],
        metadata: { sessionID: child.childID, status: "completed" },
      })
      expect(yield* jobs.get(child.childID)).toMatchObject({ result: { status: "completed", text: childText } })
      expect(yield* child.llm.requests()).toHaveLength(2)
    }),
  )

  completionIt.live("keeps an abandoned foreground job a tool error", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const child = yield* hangingChild("cancelled review", "call-cancelled-subagent")

      // Cancelling the job abandons the observation; the child itself was not stopped.
      yield* jobs.cancel(child.childID)
      expect(yield* Fiber.join(child.call)).toEqual({
        status: "error",
        error: { type: "tool.execution", message: `Subagent cancelled (sessionID: ${child.childID})` },
      })
      expect(yield* jobs.get(child.childID)).toMatchObject({ status: "cancelled" })
      expect(yield* jobs.get(child.childID)).not.toHaveProperty("result")
      yield* sessions.interrupt(child.childID)
      yield* sessions.wait(child.childID)
    }),
  )

  completionIt.live("records a user stop of a background child quietly, once, across restart replay", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const jobs = yield* Job.Service
      const bus = yield* Bus.Service
      const notifications: SessionMessage.ID[] = []
      const child = yield* hangingChild("background review", "call-user-stopped-background", { background: true })
      yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
        Effect.sync(() => {
          if (event.data.sessionID === child.parent.id && event.data.item.type === "synthetic")
            notifications.push(event.data.inboxID)
        }),
      )
      expect(yield* Fiber.join(child.call)).toMatchObject({ metadata: { status: "running" } })

      expect(yield* sessions.interrupt(child.childID)).toBeTrue()
      yield* sessions.wait(child.childID)
      yield* jobs.pendingBackground.pipe(
        Effect.repeat({ until: (pending) => pending.length === 0, schedule: Schedule.spaced("5 millis") }),
        Effect.timeout("5 seconds"),
      )
      yield* sessions.wait(child.parent.id)
      const inbox = yield* sessions.inbox(child.parent.id)
      expect(inbox).toEqual([
        expect.objectContaining({
          type: "synthetic",
          payload: {
            description: "background review",
            text: `<subagent sessionID="${child.childID}" state="stopped" description="background review">\n${SubagentOutcome.stopped}\n</subagent>`,
            metadata: { source: "subagent", childID: child.childID, agent: "reviewer", state: "stopped" },
          },
        }),
      ])
      const notificationID = inbox[0]?.id
      if (!notificationID) return yield* Effect.die("Expected a notice")
      expect(notifications).toEqual([notificationID])
      // Quiet: the idle parent made no request because of the stop.
      expect(yield* child.llm.requests()).toHaveLength(1)
      const execution = yield* SessionExecution.Service
      expect(yield* execution.isActive(child.parent.id)).toBeFalse()
      expect(yield* execution.isActive(child.childID)).toBeFalse()

      // Replay the persisted terminal after a crash between admission and acknowledgment.
      const kv = yield* KV.Service
      yield* kv.set(`job.background/${notificationID}`, {
        id: child.childID,
        notificationID,
        recovery: {
          kind: "subagent",
          parentSessionID: child.parent.id,
          childSessionID: child.childID,
          agent: "reviewer",
          description: "background review",
        },
        status: "completed",
        result: { kind: "subagent", status: "interrupted" },
      })
      yield* SessionRestart.Service.use((restart) => restart.resumeSuspendedSessions)
      yield* sessions.wait(child.parent.id)
      expect(yield* child.llm.requests()).toHaveLength(1)
      expect(yield* sessions.inbox(child.parent.id)).toEqual(inbox)
      expect(notifications).toEqual([notificationID])
      expect(yield* jobs.pendingBackground).toEqual([])

      // The recorded notice enters context at the parent's next step.
      yield* sessions.prompt({ sessionID: child.parent.id, text: "Continue with other work" })
      yield* sessions.wait(child.parent.id)
      expect(yield* sessions.inbox(child.parent.id)).toEqual([])
      expect((yield* sessions.context(child.parent.id)).filter((message) => message.type === "synthetic")).toEqual([
        expect.objectContaining({
          id: notificationID,
          metadata: { source: "subagent", childID: child.childID, agent: "reviewer", state: "stopped" },
        }),
      ])
      expect(yield* child.llm.requests()).toHaveLength(2)
    }),
  )

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
          const bus = yield* Bus.Service
          const admitted = yield* Deferred.make<Job.Background>()
          const notifications: SessionMessage.ID[] = []
          yield* bus.project(SessionEvent.InboxEnqueued, (event) =>
            Effect.gen(function* () {
              if (event.data.sessionID !== parent.id || event.data.item.type !== "synthetic") return
              notifications.push(event.data.inboxID)
              const marker = (yield* jobs.pendingBackground).find((job) => job.notificationID === event.data.inboxID)
              // The marker must survive until admission commits, not merely until delivery starts.
              expect(marker?.status).toBe("completed")
              if (marker) yield* Deferred.succeed(admitted, marker)
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
          const marker = yield* Deferred.await(admitted)
          yield* jobs.pendingBackground.pipe(Effect.repeat({ until: (pending) => pending.length === 0 }))
          yield* sessions.wait(parent.id)
          const messages = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(messages).toEqual([
            expect.objectContaining({
              id: marker.notificationID,
              description: "background review",
              text: `<subagent sessionID="${outputSessionID(result.metadata)}" state="completed" description="background review">\n${childText}\n</subagent>`,
              metadata: {
                source: "subagent",
                childID: outputSessionID(result.metadata),
                agent: "reviewer",
                state: "completed",
              },
            }),
          ])

          // Reproduce a crash after admission but before acknowledgment using the real persisted marker.
          const kv = yield* KV.Service
          yield* kv.set(`job.background/${marker.notificationID}`, marker)
          const restart = yield* SessionRestart.Service
          yield* restart.resumeSuspendedSessions
          yield* sessions.wait(parent.id)
          expect(notifications).toEqual([marker.notificationID])
          expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
            messages,
          )
          expect(yield* jobs.pendingBackground).toEqual([])
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
              input: { agent: "reviewer", description: "review", prompt: "review this" },
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
