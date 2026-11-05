import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { Instance } from "@opencode/core/instance/service"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionRestart } from "@opencode/core/session/execution/restart"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

const llmLayer = TestLLM.testLayer({ fallback: TestLLM.text("Review complete", "review") })
const it = testEffect(
  Layer.merge(
    llmLayer,
    AppNodeBuilder.build(
      LayerNode.group([
        Session.node,
        SessionStore.node,
        Job.node,
        SubagentJob.node,
        SessionExecution.node,
        LocationServiceMap.node,
        Bus.node,
        Database.node,
        Instance.node,
        SessionInbox.node,
      ]),
      [
        Global.node.replace(tempGlobalLayer),
        offlineModels,
        Watcher.node.replace(Watcher.configured({ enabled: false })),
        LayerNodePlatform.llmClient.replace(llmLayer),
        SessionRunnerModel.node.replace(
          Layer.succeed(SessionRunnerModel.Service, {
            resolve: () =>
              Effect.succeed(
                SessionRunnerModel.resolved(
                  LanguageModel.make({ id: "review", provider: "test", route: OpenAIChat.route }),
                  {
                    capabilities: { tools: true, input: ["text"], output: ["text"] },
                    cost: [],
                    limit: { context: 200_000, output: 32_000 },
                  },
                ),
              ),
          }),
        ),
      ],
    ),
  ),
)

/** A parent with a reviewer child in one directory, plus the parent's tool registry. */
const family = Effect.fnUntraced(function* (descendantMetadata?: SessionSchema.Metadata) {
  const dir = yield* tmpdirScoped()
  yield* Effect.promise(() =>
    Bun.write(
      `${dir.path}/opencode.json`,
      JSON.stringify({
        agents: { reviewer: { mode: "subagent" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    ),
  )
  const sessions = yield* Session.Service
  const locations = yield* LocationServiceMap.Service
  const parent = yield* sessions.create({
    location: { directory: AbsolutePath.make(dir.path) },
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
  })
  const child = yield* sessions.create({ parentID: parent.id, agent: Agent.ID.make("reviewer") })
  const descendant = yield* sessions.create({
    parentID: child.id,
    agent: Agent.ID.make("reviewer"),
    ...(descendantMetadata === undefined ? {} : { metadata: descendantMetadata }),
  })
  yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(Effect.provide(locations.get(parent.location)))
  const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
  const spawnWith = (background: boolean) =>
    executeTool(registry, {
      sessionID: parent.id,
      ...toolIdentity,
      call: {
        type: "tool-call",
        id: "call-review",
        name: "subagent",
        input: {
          agent: "reviewer",
          sessionID: child.id,
          description: "Review fixture",
          prompt: "Review the fixture",
          background,
        },
      },
    })
  return { sessions, parent, child, descendant, spawn: spawnWith(true), spawnWith }
})

/** Mirrors the shell tool: a backgrounded shell job whose exit notice is admitted to its owner. */
const backgroundShell = Effect.fnUntraced(function* (owner: SessionSchema.ID) {
  const jobs = yield* Job.Service
  const sessions = yield* Session.Service
  const exit = yield* Deferred.make<void>()
  yield* jobs.start({
    id: "shell-dev",
    type: "shell",
    title: "dev server",
    recovery: { kind: "shell", sessionID: owner, shellID: "shell-dev", command: "bun dev" },
    run: Deferred.await(exit).pipe(Effect.as("exited")),
  })
  yield* jobs.background("shell-dev")
  return Effect.gen(function* () {
    yield* Deferred.succeed(exit, undefined)
    const shell = (yield* jobs.wait({ id: "shell-dev" })).info
    yield* sessions.synthetic({
      ...(shell?.notificationID ? { id: shell.notificationID } : {}),
      sessionID: owner,
      text: "Background shell exited",
    })
    if (shell?.notificationID) yield* jobs.completeBackground(shell.notificationID)
  })
})

const reports = Effect.fnUntraced(function* (parentID: SessionSchema.ID) {
  const sessions = yield* Session.Service
  return (yield* sessions.context(parentID)).filter((message) => message.type === "synthetic")
})

describe("subagent observer lifetime", () => {
  for (const [evict, outcome] of [
    [false, "completed"],
    [true, "completed"],
    [true, "cancelled"],
  ] as const) {
    it.live(
      `notifies an idle parent exactly once after its moved child ${outcome} (evict=${evict})`,
      () =>
        Effect.gen(function* () {
          const parentDir = yield* tmpdirScoped()
          const childDir = yield* tmpdirScoped()
          yield* Effect.promise(() =>
            Bun.write(
              `${parentDir.path}/opencode.json`,
              JSON.stringify({
                agents: { reviewer: { mode: "subagent" } },
                permissions: [{ action: "*", resource: "*", effect: "allow" }],
              }),
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(`${childDir.path}/opencode.json`, JSON.stringify({ agents: { reviewer: { mode: "subagent" } } })),
          )
          const sessions = yield* Session.Service
          const locations = yield* LocationServiceMap.Service
          const jobs = yield* Job.Service
          const llm = yield* TestLLM.Test
          const parent = yield* sessions.create({
            location: { directory: AbsolutePath.make(parentDir.path) },
            agent: Agent.ID.make("build"),
            model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
          })
          const child = yield* sessions.create({ parentID: parent.id, agent: Agent.ID.make("reviewer") })
          yield* sessions.move({ sessionID: child.id, directory: AbsolutePath.make(childDir.path) })
          yield* sessions.wait(child.id)
          expect((yield* sessions.get(child.id)).location.directory).toBe(AbsolutePath.make(childDir.path))
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(locations.get(parent.location)),
          )
          const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
          const gate = yield* llm.gate()
          const result = yield* executeTool(registry, {
            sessionID: parent.id,
            ...toolIdentity,
            call: {
              type: "tool-call",
              id: "call-review",
              name: "subagent",
              input: {
                agent: "reviewer",
                sessionID: child.id,
                description: "Review fixture",
                prompt: "Review the fixture",
                background: true,
              },
            },
          })
          expect(result.status).toBe("completed")
          yield* gate.started
          expect(yield* sessions.context(parent.id)).toEqual([])
          if (evict) {
            yield* locations.invalidate(parent.location)
            // Rebuilding a location must not lose or duplicate its former observer.
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
              Effect.provide(locations.get(parent.location)),
            )
            yield* locations.invalidate(parent.location)
          }
          if (outcome === "cancelled") yield* jobs.cancel(child.id)
          yield* gate.release
          yield* jobs.wait({ id: child.id })
          yield* llm.wait(2).pipe(Effect.timeout("2 seconds"))
          yield* sessions.wait(parent.id)
          const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(notices).toHaveLength(1)
          expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: child.id, state: outcome } })
          expect(yield* jobs.pendingBackground).toEqual([])
          yield* locations.invalidate(parent.location)
          yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
            Effect.provide(locations.get(parent.location)),
          )
          expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual(
            notices,
          )
          expect(yield* llm.requests()).toHaveLength(2)
        }),
      20_000,
    )
  }

  for (const phase of ["running", "notice", "descendant", "failure"] as const) {
    it.live(`child waits for background work and its completion input (${phase})`, () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        yield* Effect.promise(() =>
          Bun.write(
            `${dir.path}/opencode.json`,
            JSON.stringify({
              agents: { reviewer: { mode: "subagent" } },
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            }),
          ),
        )
        const sessions = yield* Session.Service
        const locations = yield* LocationServiceMap.Service
        const jobs = yield* Job.Service
        const llm = yield* TestLLM.Test
        const parent = yield* sessions.create({
          location: { directory: AbsolutePath.make(dir.path) },
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
        })
        const child = yield* sessions.create({ parentID: parent.id, agent: Agent.ID.make("reviewer") })
        yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
          Effect.provide(locations.get(parent.location)),
        )
        const registry = yield* Tool.Service.pipe(Effect.provide(locations.get(parent.location)))
        const owner =
          phase === "descendant"
            ? yield* sessions.create({ parentID: child.id, agent: Agent.ID.make("reviewer") })
            : child
        // Background shell work can belong to the child or a deeper descendant.
        const exit = yield* Deferred.make<void>()
        yield* jobs.start({
          id: "shell-dev",
          type: "shell",
          title: "dev server",
          recovery: { kind: "shell", sessionID: owner.id, shellID: "shell-dev", command: "bun dev" },
          run: Deferred.await(exit).pipe(Effect.as("exited")),
        })
        yield* jobs.background("shell-dev")
        yield* llm.push(
          TestLLM.text("first", "first"),
          ...(phase === "descendant" ? [TestLLM.text("descendant done", "descendant")] : []),
          phase === "failure" ? Stream.die(new Error("follow-up failed")) : TestLLM.text("final", "final"),
        )
        const gate = yield* llm.gate()

        const result = yield* executeTool(registry, {
          sessionID: parent.id,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-review",
            name: "subagent",
            input: {
              agent: "reviewer",
              sessionID: child.id,
              description: "Review fixture",
              prompt: "Review the fixture",
              background: true,
            },
          },
        })
        expect(result.status).toBe("completed")
        yield* gate.started
        // Finish the shell before the child goes idle, but hold its completion input. The
        // durable marker must bridge this gap even though runningBackground is now empty.
        if (phase === "notice") {
          yield* Deferred.succeed(exit, undefined)
          yield* jobs.wait({ id: "shell-dev" })
        }
        yield* gate.release
        yield* sessions.wait(child.id)
        expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual([])
        expect((yield* jobs.get(child.id))?.status).toBe("running")

        if (phase === "failure") {
          // A failed follow-up must release the job waiter even while the shell is still running.
          yield* sessions.synthetic({ sessionID: child.id, text: "Check the work again" })
          yield* jobs.wait({ id: child.id })
          yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
          yield* sessions.wait(parent.id)
          const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
          expect(notices).toHaveLength(1)
          expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: child.id, state: "error" } })
          expect(notices[0]?.text).toContain("follow-up failed")
          expect((yield* jobs.get(child.id))?.status).not.toBe("running")
          expect((yield* jobs.get("shell-dev"))?.status).toBe("running")
          return
        }

        // Mirrors the shell tool's notifyWhenDone: admit the exit notice to the child, which wakes
        // it, then clear the durable marker.
        yield* Deferred.succeed(exit, undefined)
        const shell = (yield* jobs.wait({ id: "shell-dev" })).info
        expect(shell?.notificationID).toBeDefined()
        yield* sessions.synthetic({
          ...(shell?.notificationID ? { id: shell.notificationID } : {}),
          sessionID: owner.id,
          text: "Background shell exited",
        })
        if (shell?.notificationID) yield* jobs.completeBackground(shell.notificationID)

        yield* jobs.wait({ id: child.id })
        yield* llm.wait(phase === "descendant" ? 4 : 3).pipe(Effect.timeout("2 seconds"))
        yield* sessions.wait(parent.id)
        const notices = (yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: child.id, state: "completed" } })
        expect(notices[0]?.text).toContain("final")
        expect(notices[0]?.text).not.toContain("first")
        expect(yield* llm.requests()).toHaveLength(phase === "descendant" ? 4 : 3)
        expect(yield* jobs.pendingBackground).toEqual([])
      }),
    )
  }

  for (const launch of ["direct", "job"] as const) {
    it.live(`a ${launch} child reports once with its owned ID after its background shell exits`, () =>
      Effect.gen(function* () {
        const jobs = yield* Job.Service
        const store = yield* SessionStore.Service
        const llm = yield* TestLLM.Test
        const f = yield* family()
        const savedID = SessionMessage.ID.create()
        if (launch === "job") yield* store.holdReport(f.child.id, { notificationID: savedID, since: undefined })
        const exitShell = yield* backgroundShell(f.child.id)
        yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("final", "final"))

        if (launch === "job") expect((yield* f.spawn).status).toBe("completed")
        else yield* f.sessions.prompt({ sessionID: f.child.id, text: "Start the dev server" })
        yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))
        yield* f.sessions.wait(f.child.id)
        expect(yield* reports(f.parent.id)).toEqual([])
        expect((yield* jobs.get("shell-dev"))?.status).toBe("running")
        const held = yield* store.heldReport(f.child.id)
        expect(held).toBeDefined()
        const notificationID = launch === "job" ? (yield* jobs.get(f.child.id))?.notificationID : held?.notificationID
        expect(notificationID).toBeDefined()
        if (launch === "job") {
          expect(held).toEqual({ notificationID: savedID, since: undefined })
          expect(notificationID).not.toBe(savedID)
        }

        yield* exitShell
        if (launch === "job") yield* jobs.wait({ id: f.child.id })
        yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
        yield* f.sessions.wait(f.child.id)
        yield* f.sessions.wait(f.parent.id)
        const notices = yield* reports(f.parent.id)
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatchObject({
          id: notificationID,
          metadata: { source: "subagent", childID: f.child.id, state: "completed" },
        })
        expect(yield* store.heldReport(f.child.id)).toBeUndefined()
        expect(notices[0]?.text).toContain("final")
        expect(notices[0]?.text).not.toContain("first")
        expect(yield* jobs.pendingBackground).toEqual([])
        expect(yield* llm.requests()).toHaveLength(3)
      }),
    )
  }

  it.live("a foreground child returns its answer without waiting for its background shell", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      const exitShell = yield* backgroundShell(f.child.id)
      yield* llm.push(TestLLM.text("answer", "answer"))

      const result = yield* f.spawnWith(false).pipe(Effect.timeout("5 seconds"))
      expect(result).toMatchObject({
        status: "completed",
        metadata: { sessionID: f.child.id, status: "completed" },
        content: [{ type: "text", text: expect.stringContaining("answer") }],
      })
      expect((yield* jobs.get("shell-dev"))?.status).toBe("running")
      expect(yield* reports(f.parent.id)).toEqual([])

      yield* exitShell
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
    }),
  )

  it.live("a foreground child moved to the background holds its report until its shell exits", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      const exitShell = yield* backgroundShell(f.child.id)
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("final", "final"))
      const gate = yield* llm.gate()

      const spawn = yield* f.spawnWith(false).pipe(Effect.forkChild({ startImmediately: true }))
      yield* gate.started
      yield* jobs.background(f.child.id)
      expect(yield* Fiber.join(spawn)).toMatchObject({ metadata: { sessionID: f.child.id, status: "running" } })
      yield* gate.release
      yield* f.sessions.wait(f.child.id)
      expect(yield* reports(f.parent.id)).toEqual([])
      expect((yield* jobs.get(f.child.id))?.status).toBe("running")

      yield* exitShell
      yield* jobs.wait({ id: f.child.id })
      yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[0]?.text).toContain("final")
      expect(notices[0]?.text).not.toContain("first")
      expect(yield* jobs.pendingBackground).toEqual([])
    }),
  )

  it.live("restart recovers a directly prompted child's durable hold after cancelling its shell", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      const before = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(before, Exit.void))
      const oldJobs = yield* Job.make.pipe(Scope.provide(before))
      const old = yield* Layer.buildWithScope(
        SessionExecution.layer.pipe(Layer.provide(Layer.succeed(Job.Service, oldJobs)), Layer.fresh),
        before,
      )
      const oldExecution = Context.get(old, SessionExecution.Service)
      yield* oldJobs.start({
        id: "restart-shell",
        type: "shell",
        recovery: { kind: "shell", sessionID: f.child.id, shellID: "restart-shell", command: "bun dev" },
        run: Effect.never,
      })
      yield* oldJobs.background("restart-shell")
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("after restart", "after"))
      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Start the dev server", resume: false })
      yield* oldExecution.wake(f.child.id)
      yield* oldExecution.awaitIdle(f.child.id)
      const held = yield* store.heldReport(f.child.id)
      expect(held).toBeDefined()
      expect(yield* reports(f.parent.id)).toEqual([])
      yield* Scope.close(before, Exit.void)
      expect(yield* store.heldReport(f.child.id)).toEqual(held)

      const after = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(after, Exit.void))
      const jobs = yield* Job.make.pipe(Scope.provide(after))
      const context = yield* Layer.buildWithScope(
        SessionRestart.layer().pipe(
          Layer.provideMerge(SubagentJob.layer),
          Layer.provideMerge(SessionExecution.layer),
          Layer.provide(Layer.succeed(Job.Service, jobs)),
          Layer.fresh,
        ),
        after,
      )
      const restart = Context.get(context, SessionRestart.Service)
      const execution = Context.get(context, SessionExecution.Service)
      yield* restart.resumeSuspendedSessions
      yield* execution.awaitIdle(f.child.id)
      yield* execution.awaitIdle(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ id: held?.notificationID, metadata: { childID: f.child.id } })
      expect(notices[0]?.text).toContain("after restart")
      expect(notices[0]?.text).not.toContain("first")
      expect(yield* store.listHeldChildren()).toEqual([])
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* llm.requests()).toHaveLength(3)
      expect((yield* f.sessions.context(f.child.id)).filter((message) => message.type === "synthetic")).toMatchObject([
        { text: expect.stringContaining("server restarted") },
      ])
      yield* restart.resumeSuspendedSessions
      expect(yield* reports(f.parent.id)).toEqual(notices)
      expect(yield* llm.requests()).toHaveLength(3)
    }),
  )

  for (const outcome of ["complete", "shutdown"] as const) {
    it.live(`restart retains a child's job through its silent grandchild's settlement (${outcome})`, () =>
      Effect.gen(function* () {
        const store = yield* SessionStore.Service
        const llm = yield* TestLLM.Test
        const f = yield* family()
        const build = (scope: Scope.Closeable, jobs: Job.Interface) =>
          Layer.buildWithScope(
            SessionRestart.layer().pipe(
              Layer.provideMerge(SubagentJob.layer),
              Layer.provideMerge(SessionExecution.layer),
              Layer.provide(Layer.succeed(Job.Service, jobs)),
              Layer.fresh,
            ),
            scope,
          )
        const before = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(before, Exit.void))
        const oldJobs = yield* Job.make.pipe(Scope.provide(before))
        const old = yield* build(before, oldJobs)
        const oldSubagents = Context.get(old, SubagentJob.Service)
        const oldExecution = Context.get(old, SessionExecution.Service)
        const child = {
          recovery: {
            kind: "subagent" as const,
            parentSessionID: f.parent.id,
            childSessionID: f.child.id,
            agent: "reviewer",
            description: "Review fixture",
          },
          notify: true,
        }
        const descendant = {
          recovery: {
            ...child.recovery,
            parentSessionID: f.child.id,
            childSessionID: f.descendant.id,
            description: "Check the tests",
          },
          notify: false,
        }
        yield* llm.push(Stream.never, TestLLM.text("before restart", "before"))
        yield* f.sessions.prompt({ sessionID: f.descendant.id, text: "Check the tests", resume: false })
        yield* oldSubagents.start(descendant)
        yield* oldSubagents.background(descendant)
        yield* llm.wait(1)
        yield* f.sessions.prompt({ sessionID: f.child.id, text: "Review fixture", resume: false })
        yield* oldSubagents.start(child)
        yield* oldSubagents.background(child)
        yield* llm.wait(2)
        yield* oldExecution.awaitIdle(f.child.id)
        const held = yield* store.heldReport(f.child.id)
        const markers = yield* oldJobs.pendingBackground
        expect(held).toBeDefined()
        expect(markers).toHaveLength(2)
        expect(markers.every((row) => row.status === "running")).toBe(true)
        yield* Scope.close(before, Exit.void)
        expect(yield* oldJobs.pendingBackground).toEqual(markers)
        expect(yield* store.heldReport(f.child.id)).toEqual(held)
        expect(yield* reports(f.parent.id)).toEqual([])

        const after = yield* Scope.make()
        yield* Effect.addFinalizer(() => Scope.close(after, Exit.void))
        const jobs = yield* Job.make.pipe(Scope.provide(after))
        const go = yield* Deferred.make<void>()
        const settled = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        const cleared = yield* Deferred.make<void>()
        const context = yield* build(after, {
          ...jobs,
          // Hold the real job just after D's execution settles: C's wake must observe D
          // still running and hold again before its completion observer gets to clear D.
          start: (input) =>
            jobs.start({
              ...input,
              run:
                input.id !== f.descendant.id
                  ? input.run
                  : input.run.pipe(
                      Effect.tap(() =>
                        Deferred.succeed(settled, undefined).pipe(Effect.andThen(Deferred.await(finish))),
                      ),
                    ),
            }),
          completeBackground: (id) =>
            jobs
              .completeBackground(id)
              .pipe(
                Effect.tap(() => (id === held?.notificationID ? Deferred.succeed(cleared, undefined) : Effect.void)),
              ),
        })
        const restart = Context.get(context, SessionRestart.Service)
        const execution = Context.get(context, SessionExecution.Service)
        yield* llm.push(
          Stream.unwrap(
            Deferred.await(go).pipe(Effect.as(Stream.fromIterable(TestLLM.text("grandchild done", "grandchild")))),
          ),
          TestLLM.text("after restart", "after"),
        )
        yield* restart.resumeSuspendedSessions
        yield* llm.wait(4)
        yield* execution.awaitIdle(f.child.id)
        expect(yield* store.heldReport(f.child.id)).toEqual(held)
        expect((yield* jobs.get(f.child.id))?.status).toBe("running")
        expect(yield* reports(f.parent.id)).toEqual([])
        if (outcome === "shutdown") {
          yield* Scope.close(after, Exit.void)
          expect(yield* jobs.pendingBackground).toEqual(markers)
          expect(yield* store.heldReport(f.child.id)).toEqual(held)
          expect(yield* reports(f.parent.id)).toEqual([])
          expect((yield* reports(f.child.id)).filter((message) => message.metadata?.source === "subagent")).toEqual([])
          return
        }
        yield* Deferred.succeed(go, undefined)
        yield* Deferred.await(settled)
        yield* execution.awaitIdle(f.child.id)
        expect((yield* jobs.get(f.descendant.id))?.status).toBe("running")
        expect((yield* jobs.get(f.child.id))?.status).toBe("running")
        expect(yield* store.heldReport(f.child.id)).toEqual(held)
        expect(yield* reports(f.parent.id)).toEqual([])

        yield* Deferred.succeed(finish, undefined)
        yield* Deferred.await(cleared)
        yield* llm.wait(5)
        yield* execution.awaitIdle(f.parent.id)
        const notices = yield* reports(f.parent.id)
        expect(notices).toHaveLength(1)
        expect(notices[0]).toMatchObject({
          id: held?.notificationID,
          metadata: { source: "subagent", childID: f.child.id, state: "completed" },
        })
        expect(notices[0]?.text).toContain("after restart")
        expect(notices[0]?.text).not.toContain("grandchild done")
        expect(notices[0]?.text).not.toContain("before restart")
        expect(yield* jobs.pendingBackground).toEqual([])
        expect(yield* store.listHeldChildren()).toEqual([])
        expect(yield* llm.requests()).toHaveLength(5)
        yield* restart.resumeSuspendedSessions
        expect(yield* reports(f.parent.id)).toEqual(notices)
        expect(yield* llm.requests()).toHaveLength(5)
      }),
    )
  }

  it.live("a silent background grandchild job releases its parent's held report", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const subagents = yield* SubagentJob.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      const go = yield* Deferred.make<void>()
      yield* llm.push(
        Stream.unwrap(
          Deferred.await(go).pipe(Effect.as(Stream.fromIterable(TestLLM.text("grandchild done", "grandchild")))),
        ),
        TestLLM.text("first", "first"),
      )
      const input = {
        recovery: {
          kind: "subagent" as const,
          parentSessionID: f.child.id,
          childSessionID: f.descendant.id,
          agent: "reviewer",
          description: "Check the tests",
        },
        notify: false,
      }
      yield* f.sessions.prompt({ sessionID: f.descendant.id, text: "Check the tests", resume: false })
      yield* subagents.start(input)
      yield* subagents.background(input)
      yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))

      expect((yield* f.spawn).status).toBe("completed")
      yield* llm.wait(2).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.child.id)
      expect(yield* reports(f.parent.id)).toEqual([])
      expect((yield* jobs.get(f.child.id))?.status).toBe("running")

      yield* Deferred.succeed(go, undefined)
      yield* jobs.wait({ id: f.child.id }).pipe(Effect.timeout("5 seconds"))
      yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[0]?.text).toContain("first")
      expect(notices[0]?.text).not.toContain("grandchild done")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* llm.requests()).toHaveLength(3)
    }),
  )

  it.live("a silent descendant woken by its shell releases the child's held report", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const f = yield* family({ "subagent.notify": false })
      const exitShell = yield* backgroundShell(f.descendant.id)
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("descendant done", "descendant"))

      expect((yield* f.spawn).status).toBe("completed")
      yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.child.id)
      expect(yield* reports(f.parent.id)).toEqual([])
      expect((yield* jobs.get(f.child.id))?.status).toBe("running")

      yield* exitShell
      yield* jobs.wait({ id: f.child.id }).pipe(Effect.timeout("5 seconds"))
      yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[0]?.text).toContain("first")
      expect(notices[0]?.text).not.toContain("descendant done")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* llm.requests()).toHaveLength(3)
    }),
  )

  it.live("a silent chain releases the nearest held ancestor's report", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const f = yield* family({ "subagent.notify": false })
      const grandchild = yield* f.sessions.create({
        parentID: f.descendant.id,
        agent: Agent.ID.make("reviewer"),
        metadata: { "subagent.notify": false },
      })
      const exitShell = yield* backgroundShell(grandchild.id)
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("grandchild done", "grandchild"))

      expect((yield* f.spawn).status).toBe("completed")
      yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.child.id)
      expect(yield* reports(f.parent.id)).toEqual([])

      // The silent descendant between them never held, so the grandchild must wake the child.
      yield* exitShell
      yield* jobs.wait({ id: f.child.id }).pipe(Effect.timeout("5 seconds"))
      yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[0]?.text).toContain("first")
      expect(yield* llm.requests()).toHaveLength(3)
    }),
  )

  it.live("a no-input wake after a child reported sends no second report", () =>
    Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      yield* llm.push(TestLLM.text("done", "done"))

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check the tests" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      expect(yield* reports(f.parent.id)).toHaveLength(1)
      const requests = (yield* llm.requests()).length

      // The wake a silent descendant's release sends: no input, so no model step.
      yield* execution.wake(f.child.id)
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      expect(yield* reports(f.parent.id)).toHaveLength(1)
      expect(yield* llm.requests()).toHaveLength(requests)
    }),
  )

  it.live("a re-prompted child reports only the answer from that busy period", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const f = yield* family()
      yield* llm.push(
        TestLLM.text("first", "first"),
        TestLLM.text("Parent heard the first report", "parent-first"),
        TestLLM.text("second", "second"),
        TestLLM.text("Parent heard the second report", "parent-second"),
      )

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check the tests" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      const opening = yield* reports(f.parent.id)
      expect(opening).toHaveLength(1)
      expect(opening[0]?.text).toContain("first")

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check them again" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(2)
      expect(notices[1]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[1]?.text).toContain("second")
      expect(notices[1]?.text).not.toContain("first")
    }),
  )

  it.live("a background child re-prompted upon report admission reports a second answer", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const bus = yield* Bus.Service
      const jobs = yield* Job.Service
      const store = yield* SessionStore.Service
      const f = yield* family()
      yield* llm.push(TestLLM.text("first", "first"))
      yield* llm.serve((request) =>
        JSON.stringify(request.messages.at(-1)).includes("Check them again")
          ? TestLLM.text("second", "second")
          : TestLLM.text("Parent heard the report", "parent"),
      )
      const gate = yield* llm.gate()
      const reprompt = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
        Stream.filter((event) => event.data.sessionID === f.parent.id),
        Stream.take(1),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            expect(event.data.item.type).toBe("synthetic")
            if (event.data.item.type !== "synthetic") throw new Error("Expected a child report")
            // Nested asymmetric Bun matchers mutate their input; keep the live event payload intact.
            expect(event.data.item.payload.text).toContain("first")
            const job = yield* jobs.get(f.child.id)
            expect(job).toMatchObject({ status: "running", notificationID: event.data.inboxID })
            yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check them again" })
            expect(yield* jobs.get(f.child.id)).toMatchObject({ status: "running", started_at: job?.started_at })
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      expect((yield* f.spawn).status).toBe("completed")
      yield* gate.started
      const job = yield* jobs.get(f.child.id)
      yield* gate.release
      yield* Fiber.join(reprompt)
      yield* jobs.wait({ id: f.child.id })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)

      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(2)
      expect(notices[0]).toMatchObject({ id: job?.notificationID })
      expect(notices[0]?.text).toContain("first")
      expect(notices[1]?.id).not.toBe(notices[0]?.id)
      expect(notices[1]?.text).toContain("second")
      expect(notices[1]?.text).not.toContain("first")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* store.heldReport(f.child.id)).toBeUndefined()
    }),
  )

  it.live("a reverted and re-prompted child reports its new answer", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const f = yield* family()
      yield* llm.push(
        TestLLM.text("first", "first"),
        TestLLM.text("Parent heard the first report", "parent-first"),
        TestLLM.text("second", "second"),
        TestLLM.text("Parent heard the second report", "parent-second"),
      )

      const opening = yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check the tests" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      expect(yield* reports(f.parent.id)).toHaveLength(1)

      // A committed revert deletes this period's anchor row; the next period must still report.
      yield* f.sessions.revert.stage({ sessionID: f.child.id, messageID: opening.id, files: false })
      yield* f.sessions.revert.commit(f.child.id)
      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check them again" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(2)
      expect(notices[1]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[1]?.text).toContain("second")
      expect(notices[1]?.text).not.toContain("first")
    }),
  )

  it.live("a failed follow-up does not re-send the earlier answer", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLM.Test
      const f = yield* family()
      yield* llm.push(
        TestLLM.text("first", "first"),
        TestLLM.text("Parent heard the first report", "parent-first"),
        Stream.die(new Error("follow-up failed")),
        TestLLM.text("Parent heard the failure", "parent-failure"),
      )

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check the tests" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      expect(yield* reports(f.parent.id)).toHaveLength(1)

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Check them again" })
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(2)
      expect(notices[1]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "error" } })
      expect(notices[1]?.text).toContain("follow-up failed")
      expect(notices[1]?.text).not.toContain("first")
    }),
  )

  it.live("a spawned child runs from its prompt and reports to its parent", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(
          `${dir.path}/opencode.json`,
          JSON.stringify({
            agents: { reviewer: { mode: "subagent" } },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          }),
        ),
      )
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const llm = yield* TestLLM.Test
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
      })
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
        Effect.provide(locations.get(parent.location)),
      )

      const spawned = yield* sessions.spawn({
        parent: { id: parent.id },
        agent: Agent.ID.make("reviewer"),
        title: "Review fixture",
        prompt: { text: "Review the fixture" },
      })
      // The default resume wakes the child, so the spawn alone starts the run.
      yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))
      yield* sessions.wait(spawned.id)
      // The report wakes the parent for one more step.
      yield* llm.wait(2).pipe(Effect.timeout("2 seconds"))
      yield* sessions.wait(parent.id)

      const notices = yield* reports(parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: spawned.id, state: "completed" } })
      expect(notices[0]?.text).toContain("Review complete")
    }),
  )

  it.live("a spawn that asks for silence reports nothing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        Bun.write(
          `${dir.path}/opencode.json`,
          JSON.stringify({
            agents: { reviewer: { mode: "subagent" } },
            permissions: [{ action: "*", resource: "*", effect: "allow" }],
          }),
        ),
      )
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const llm = yield* TestLLM.Test
      const parent = yield* sessions.create({
        location: { directory: AbsolutePath.make(dir.path) },
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("parent"), providerID: Provider.ID.make("test") }),
      })
      yield* Plugin.Service.use((plugins) => plugins.awaitActivation).pipe(
        Effect.provide(locations.get(parent.location)),
      )

      const spawned = yield* sessions.spawn({
        parent: { id: parent.id, notify: false },
        agent: Agent.ID.make("reviewer"),
        prompt: { text: "Review the fixture" },
      })
      expect((yield* sessions.get(spawned.id)).metadata).toEqual({ "subagent.notify": false })
      yield* llm.wait(1).pipe(Effect.timeout("2 seconds"))
      yield* sessions.wait(spawned.id)
      expect(yield* reports(parent.id)).toEqual([])
      const before = (yield* llm.requests()).length

      // A later prompt on the parent is the only input it ever receives.
      yield* sessions.prompt({ sessionID: parent.id, text: "Review the fixture" })
      yield* llm.wait(before + 1).pipe(Effect.timeout("2 seconds"))
      yield* sessions.wait(parent.id)
      expect(yield* reports(parent.id)).toEqual([])
      expect((yield* sessions.context(parent.id)).filter((message) => message.type === "synthetic")).toEqual([])
    }),
  )
})
