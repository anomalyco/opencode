import { expect } from "bun:test"
import { Context, Effect, Layer, Scope, Stream } from "effect"
import { Money } from "@opencode/schema/money"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { filesystem } from "@opencode/util/effect/app-node-platform"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
import { Tool } from "@opencode/core/tool"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { toolIdentity, executeTool } from "./lib/tool"

const sessionID = Session.ID.make("ses_shell_tool_test")
const sessionModel = Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") })
const assertions: Permission.AssertInput[] = []
let denyAction: string | undefined
let afterPermission = (_input: Permission.AssertInput): Effect.Effect<void> => Effect.void

const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => assertions.push(input)).pipe(
      Effect.andThen(Effect.suspend(() => afterPermission(input))),
      Effect.andThen(
        input.action === denyAction
          ? Effect.fail(
              new Permission.BlockedError({
                rules: [],
                permission: input.action,
                resources: input.resources,
              }),
            )
          : Effect.void,
      ),
    ),
})

const reset = () => {
  assertions.length = 0
  denyAction = undefined
  afterPermission = () => Effect.void
}

const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const complete = Effect.fn("ShellTest.complete")(function* (id: Session.ID) {
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
        yield* bus.publish(SessionEvent.Text.Started, {
          sessionID: id,
          assistantMessageID,
          ordinal: 0,
        })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID: id,
          assistantMessageID,
          ordinal: 0,
          text: "ok",
        })
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
const replacements = [
  SessionExecution.node.replace(executionNode),
  Permission.node.replace(permission),
  Global.node.replace(tempGlobalLayer),
  offlineModels,
] satisfies LayerNode.Replacements
const productionIt = testEffect(AppNodeBuilder.build(nodes, replacements))

const call = (input: typeof ShellTool.Input.Type, id = "call-shell") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "shell", input },
})

const withSession = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    yield* sessions.create({
      id: sessionID,
      title: "shell test",
      location,
      model: sessionModel,
    })
    const locations = yield* LocationServiceMap.Service
    const locationLayer = locations.get(location)
    return yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      yield* plugins.awaitActivation
      const registry = yield* Tool.Service
      return yield* body(registry)
    }).pipe(Effect.provide(locationLayer), Effect.ensuring(locations.invalidate(location)))
  })


// Repro for anomalyco/opencode#56729
const scenario = (rebuild: boolean) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      reset()
      return withSession(tmp.path, (registry) =>
        Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const jobs = yield* Job.Service
          const bus = yield* Bus.Service
          const starts = { shell: 0, closed: 0 }
          // Capture services only (no Scope), like PluginInternal.list.
          const context = Context.omit(Scope.Scope)(yield* Effect.context<any>())
          const prefix: Plugin.Generation = { id: "audit.prefix", revision: "1", effect: () => Effect.void }
          const shellGen: Plugin.Generation = {
            id: ShellTool.Plugin.id,
            revision: "1",
            effect: (host) =>
              Effect.gen(function* () {
                starts.shell++
                yield* Effect.addFinalizer(() => Effect.sync(() => starts.closed++))
                yield* ShellTool.Plugin.effect(host as any)
              }).pipe(Effect.provide(context)) as any,
          }
          yield* plugins.activate([prefix, shellGen])
          const notices: unknown[] = []
          yield* bus.subscribe(SessionEvent.InboxEnqueued).pipe(
            Stream.filter((e) => e.data.sessionID === sessionID && e.data.item.type === "synthetic"),
            Stream.runForEach((e) => Effect.sync(() => notices.push(e.data.item.payload))),
            Effect.forkScoped({ startImmediately: true }),
          )
          const settled = yield* executeTool(
            registry,
            call({ command: "sleep 1; printf fixture-output", background: true }, "call-bg-" + rebuild),
          )
          const shellID = settled.metadata?.shellID as string
          expect(settled.output?.status).toBe("running")
          expect((yield* jobs.pendingBackground).length).toBe(1)

          yield* plugins.activate(rebuild ? [shellGen] : [prefix, shellGen])

          const result = yield* jobs.wait({ id: shellID })
          const deadline = Date.now() + 2_000
          while (notices.length === 0 && Date.now() < deadline) yield* Effect.sleep("25 millis")
          const pending = yield* jobs.pendingBackground
          expect(result.info?.status).toBe("completed")
          expect(notices.length).toBe(1)
          expect(pending.length).toBe(0)
        }),
      )
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]().then(() => undefined)),
  )

productionIt.live("control: unchanged activation delivers the background notification", () => scenario(false), {
  timeout: 20_000,
})
productionIt.live("rebuilt shell suffix still delivers the background notification", () => scenario(true), {
  timeout: 20_000,
})

