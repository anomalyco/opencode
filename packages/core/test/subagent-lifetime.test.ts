import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Stream } from "effect"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
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
      LayerNode.group([Session.node, Job.node, SubagentJob.node, SessionExecution.node, LocationServiceMap.node]),
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
  const spawn = executeTool(registry, {
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
  return { sessions, parent, child, descendant, spawn }
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

  it.live("a directly prompted child reports once, only after its background shell exits", () =>
    Effect.gen(function* () {
      const jobs = yield* Job.Service
      const llm = yield* TestLLM.Test
      const f = yield* family()
      const exitShell = yield* backgroundShell(f.child.id)
      yield* llm.push(TestLLM.text("first", "first"), TestLLM.text("final", "final"))

      yield* f.sessions.prompt({ sessionID: f.child.id, text: "Start the dev server" })
      yield* f.sessions.wait(f.child.id)
      expect(yield* reports(f.parent.id)).toEqual([])
      expect((yield* jobs.get("shell-dev"))?.status).toBe("running")

      yield* exitShell
      yield* llm.wait(3).pipe(Effect.timeout("2 seconds"))
      yield* f.sessions.wait(f.child.id)
      yield* f.sessions.wait(f.parent.id)
      const notices = yield* reports(f.parent.id)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ metadata: { source: "subagent", childID: f.child.id, state: "completed" } })
      expect(notices[0]?.text).toContain("final")
      expect(notices[0]?.text).not.toContain("first")
      expect(yield* jobs.pendingBackground).toEqual([])
      expect(yield* llm.requests()).toHaveLength(3)
    }),
  )

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
})
