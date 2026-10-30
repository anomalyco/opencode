import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, Queue, Schema, Scope, Stream } from "effect"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { Tool } from "@opencode/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionModel = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const complete = Effect.fn("AutoBgTest.complete")(function* (id: Session.ID) {
        const session = yield* store.get(id)
        if (!session) return
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID: id,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("code"),
          model: sessionModel,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, { sessionID: id, assistantMessageID, ordinal: 0 })
        yield* bus.publish(SessionEvent.Text.Ended, { sessionID: id, assistantMessageID, ordinal: 0, text: "ok" })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID: id,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: complete,
        wake: () => Effect.void,
        interrupt: () => Effect.succeed(false),
        awaitIdle: (id) => complete(id).pipe(Effect.exit, Effect.asVoid),
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node],
})

const shellPluginSupervisor = makeLocationNode({
  name: "test/auto-bg-plugins",
  layer: Layer.effectDiscard(registerToolPlugin(ShellTool.Plugin)),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    Permission.node,
    Session.node,
    Job.node,
    Shell.node,
    ShellSelect.node,
    Tool.node,
  ],
})

const nodes = LayerNode.group([
  Database.node,
  Bus.node,
  Job.node,
  Session.node,
  SessionExecution.node,
  LocationServiceMap.node,
  filesystem,
  FSUtil.node,
  Global.node,
])

const it = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
    Global.node.replace(tempGlobalLayer),
    PluginSupervisor.node.replace(shellPluginSupervisor),
    offlineModels,
  ]),
)

const pendingPermissionIt = testEffect(
  AppNodeBuilder.build(nodes, [
    SessionExecution.node.replace(executionNode),
    Global.node.replace(tempGlobalLayer),
    PluginSupervisor.node.replace(shellPluginSupervisor),
    offlineModels,
  ]),
)

describe("Tool auto-backgrounding", () => {
  it.live("defaults yield_after to 10 seconds", () =>
    Effect.sync(() => {
      expect(Job.DEFAULT_YIELD_AFTER_MS).toBe(10_000)
    }),
  )

  it.live("yields a slow shell command with partial output and still delivers after Location reload", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const database = yield* Database.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const session = yield* sessions.create({ location, model: sessionModel })

          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === session.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          const yielded = yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const registry = yield* Tool.Service
            return yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-slow-shell",
                name: "shell",
                input: {
                  command: "printf 'booting\\n'; sleep 0.25; printf 'ready\\n'",
                  yield_after: 60,
                },
              },
            })
          }).pipe(Effect.provide(locations.get(location)))

          expect(yielded.status).toBe("completed")
          expect(yielded.metadata).toMatchObject({ status: "running" })
          yield* Tool.Service.use((tools) => tools.reload()).pipe(Effect.provide(locations.get(location)))

          const items = Array.from(yield* Fiber.join(admitted).pipe(Effect.timeout("5 seconds")))
          expect(items).toHaveLength(1)
          yield* SessionInbox.promote(database.db, bus, session.id, "steer")
          const synthetic = (yield* sessions.context(session.id)).filter((msg) => msg.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          expect(synthetic[0]?.text).toContain("booting")
          expect(synthetic[0]?.text).toContain("ready")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("auto-backgrounds Code Mode execute through Tool.execute while preserving nested tool return types", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const database = yield* Database.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const session = yield* sessions.create({ location, model: sessionModel })
          const gate = yield* Deferred.make<void>()

          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === session.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          const yielded = yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const registry = yield* Tool.Service
            yield* registry.transform((editor) => {
              editor.namespace({ name: "demo", description: "Demo tools" })
              editor.add({
                name: "slow_lookup",
                description: "Slow lookup",
                options: { namespace: "demo", codemode: true },
                input: Schema.Struct({ key: Schema.String }),
                output: Schema.Struct({ port: Schema.Number }),
                execute: () => Deferred.await(gate).pipe(Effect.as({ output: { port: 8491 }, content: "8491" })),
              })
            })
            return yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: {
                type: "tool-call",
                id: "call-slow-codemode",
                name: "execute",
                input: {
                  code: `console.log("starting lookup"); const res = await tools.demo.slow_lookup({ key: "api" }); return { found: res.port }`,
                  yield_after: 40,
                },
              },
            })
          }).pipe(Effect.provide(locations.get(location)))

          expect(yielded.status).toBe("completed")
          expect(yielded.metadata).toMatchObject({ status: "running" })
          const jobID = String(yielded.metadata?.jobID)
          expect(jobID).toStartWith("job_")
          const yieldedText = yielded.content?.[0]?.type === "text" ? yielded.content[0].text : ""
          expect(yieldedText).toContain("Code Mode execution moved to the background")
          expect(yieldedText).toContain("starting lookup")

          yield* locations.invalidate(location)

          yield* Deferred.succeed(gate, undefined)
          const items = Array.from(yield* Fiber.join(admitted).pipe(Effect.timeout("3 seconds")))
          expect(items).toHaveLength(1)
          yield* SessionInbox.promote(database.db, bus, session.id, "steer")
          const synthetic = (yield* sessions.context(session.id)).filter((msg) => msg.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          expect(synthetic[0]?.text).toContain(`<execute id="${jobID}" state="completed">`)
          expect(synthetic[0]?.text).toContain('"found": 8491')
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("auto-backgrounds custom plugin and direct tools on Ctrl+B or yield_after, while respecting background: false", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const jobs = yield* Job.Service
          const bus = yield* Bus.Service
          const database = yield* Database.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const session = yield* sessions.create({ location, model: sessionModel })
          const deployGate = yield* Deferred.make<void>()
          const syncGate = yield* Deferred.make<void>()

          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === session.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const registry = yield* Tool.Service
            yield* registry.transform((editor) => {
              editor.add({
                name: "deploy_preview",
                description: "Deploy preview",
                options: { codemode: false },
                input: Schema.Struct({ branch: Schema.String }),
                execute: ({ branch }, ctx) =>
                  ctx.progress({ title: `Deploying ${branch}` }).pipe(
                    Effect.andThen(Deferred.await(deployGate)),
                    Effect.as({ content: `Deployed ${branch} to https://preview.example` }),
                  ),
              })
              editor.add({
                name: "local_mutator",
                description: "Synchronous mutator",
                options: { codemode: false, background: false },
                input: Schema.Struct({}),
                execute: () => Deferred.await(syncGate).pipe(Effect.as({ content: "mutated" })),
              })
            })

            const scope = yield* Scope.Scope
            const deployFiber = yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-deploy", name: "deploy_preview", input: { branch: "dev" } },
            }).pipe(Effect.forkIn(scope, { startImmediately: true }))

            const mutatorFiber = yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-mutator", name: "local_mutator", input: {} },
            }).pipe(Effect.forkIn(scope, { startImmediately: true }))

            yield* Effect.sleep(Duration.millis(25))
            const moved = yield* jobs.backgroundAll({ sessionID: session.id })
            expect(moved).toHaveLength(1)
            expect(moved[0]?.type).toBe("deploy_preview")

            const deployYielded = yield* Fiber.join(deployFiber)
            expect(deployYielded.metadata).toMatchObject({ status: "running", jobID: moved[0]?.id })
            const text = deployYielded.content?.[0]?.type === "text" ? deployYielded.content[0].text : ""
            expect(text).toContain("Deploying dev")

            expect(mutatorFiber.pollUnsafe()).toBeUndefined()
            yield* Deferred.succeed(syncGate, undefined)
            const mutatorDone = yield* Fiber.join(mutatorFiber)
            expect(mutatorDone.content).toEqual([{ type: "text", text: "mutated" }])
          }).pipe(Effect.provide(locations.get(location)))

          yield* Deferred.succeed(deployGate, undefined)
          yield* Fiber.join(admitted).pipe(Effect.timeout("3 seconds"))
          yield* SessionInbox.promote(database.db, bus, session.id, "steer")
          const synthetic = (yield* sessions.context(session.id)).filter((msg) => msg.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          expect(synthetic[0]?.text).toContain('state="completed"')
          expect(synthetic[0]?.text).toContain("https://preview.example")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  pendingPermissionIt.live("pauses yield_after while waiting on a user permission prompt", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const session = yield* sessions.create({ location, model: sessionModel })

          const asked = yield* Queue.unbounded<Permission.Request>()
          yield* bus.subscribe(Permission.Event.Asked).pipe(
            Stream.runForEach((event) => Queue.offer(asked, event.data)),
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const permission = yield* Permission.Service
            const agents = yield* Agent.Service
            yield* agents.transform((editor) =>
              editor.update(toolIdentity.agent, (agent) => {
                agent.permissions = [{ action: "gated_tool", resource: "*", effect: "ask" }]
              }),
            )
            const registry = yield* Tool.Service
            yield* registry.transform((editor) => {
              editor.add({
                name: "gated_tool",
                description: "Needs permission first",
                options: { codemode: false },
                input: Schema.Struct({ yield_after: Schema.Number }),
                execute: (_input, ctx) =>
                  permission
                    .assert({
                      action: "gated_tool",
                      resources: ["*"],
                      save: ["*"],
                      sessionID: ctx.sessionID,
                      agent: ctx.agent,
                      source: { type: "tool", messageID: ctx.messageID, id: ctx.id },
                    })
                    .pipe(
                      Effect.mapError((err) => new Tool.Error({ message: err.message })),
                      Effect.as({ content: "approved inline" }),
                    ),
              })
            })

            const callFiber = yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-gated", name: "gated_tool", input: { yield_after: 30 } },
            }).pipe(Effect.forkScoped)

            const req = yield* Queue.take(asked)
            yield* Effect.sleep(Duration.millis(120))
            expect(callFiber.pollUnsafe()).toBeUndefined()

            yield* permission.reply({ requestID: req.id, reply: "once" })
            const settled = yield* Fiber.join(callFiber)
            expect(settled.status).toBe("completed")
            expect(settled.content).toEqual([{ type: "text", text: "approved inline" }])
          }).pipe(Effect.provide(locations.get(location)), Effect.scoped)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )

  it.live("truncates oversized background tool output and saves returned file attachments", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const database = yield* Database.Service
          const locations = yield* LocationServiceMap.Service
          const location = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
          const session = yield* sessions.create({ location, model: sessionModel })
          const gate = yield* Deferred.make<void>()
          const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

          const admitted = yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((event) => event.data.sessionID === session.id && event.data.item.type === "synthetic"),
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* Effect.gen(function* () {
            yield* Plugin.Service.use((plugins) => plugins.awaitActivation)
            const registry = yield* Tool.Service
            yield* registry.transform((editor) => {
              editor.add({
                name: "heavy_report",
                description: "Returns large text plus an image",
                options: { codemode: false },
                input: Schema.Struct({ yield_after: Schema.Number }),
                execute: () =>
                  Deferred.await(gate).pipe(
                    Effect.as({
                      content: [
                        { type: "text" as const, text: Array.from({ length: 2_500 }, (_, i) => `row-${i}`).join("\n") },
                        { type: "file" as const, uri: `data:image/png;base64,${png}`, mime: "image/png", name: "chart.png" },
                      ],
                    }),
                  ),
              })
            })
            const yielded = yield* executeTool(registry, {
              sessionID: session.id,
              ...toolIdentity,
              call: { type: "tool-call", id: "call-heavy", name: "heavy_report", input: { yield_after: 20 } },
            })
            expect(yielded.metadata).toMatchObject({ status: "running" })
          }).pipe(Effect.provide(locations.get(location)))

          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.join(admitted).pipe(Effect.timeout("3 seconds"))
          yield* SessionInbox.promote(database.db, bus, session.id, "steer")
          const synthetic = (yield* sessions.context(session.id)).filter((msg) => msg.type === "synthetic")
          expect(synthetic).toHaveLength(1)
          const noticeText = synthetic[0]?.text ?? ""
          expect(noticeText).toContain("full output saved to ")
          expect(noticeText).not.toContain("row-2499")
          const savedMatch = /Saved file \(chart\.png\): ([^\s]+\.png)/.exec(noticeText)
          expect(savedMatch?.[1]).toBeDefined()
          expect(yield* Effect.promise(() => Bun.file(savedMatch![1]!).exists())).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
    ),
  )
})
