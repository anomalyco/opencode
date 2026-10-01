import path from "path"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Queue, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { FileAccess } from "@opencode/core/file-access"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Monitor } from "@opencode/core/monitor"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Tool } from "@opencode/core/tool"
import { MonitorTool } from "@opencode/core/tool/plugin/monitor"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const supervisor = makeLocationNode({
  name: "test/monitor-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(MonitorTool.Plugin)),
  deps: [
    Config.node,
    Environment.node,
    FileAccess.node,
    Monitor.node,
    Permission.node,
    Session.node,
    Shell.node,
    ShellSelect.node,
    Tool.node,
  ],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, Monitor.node, LocationServiceMap.node, Bus.node]), [
    SessionExecution.node.replace(
      Layer.succeed(
        SessionExecution.Service,
        SessionExecution.Service.of({
          active: Effect.succeed(new Set<Session.ID>()),
          isActive: () => Effect.succeed(false),
          resume: () => Effect.void,
          wake: () => Effect.void,
          interrupt: () => Effect.succeed(false),
          awaitIdle: () => Effect.void,
        }),
      ),
    ),
    PluginSupervisor.node.replace(supervisor),
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)

describe("MonitorTool permissions", () => {
  it.live("uses the shell approval prompt and does not spawn when approval is rejected", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const marker = path.join(directory.path, "must-not-exist")
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const monitors = yield* Monitor.Service
      const location = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const session = yield* sessions.create({
        location,
        model: Model.Ref.make({ id: Model.ID.make("test"), providerID: Provider.ID.make("test") }),
      })
      yield* Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        yield* plugin.awaitActivation
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(toolIdentity.agent, (agent) => {
            agent.permissions = []
          }),
        )
        const bus = yield* Bus.Service
        const permission = yield* Permission.Service
        const tools = yield* Tool.Service
        const shell = yield* Shell.Service
        const requested = yield* Queue.unbounded<Permission.Request>()
        yield* bus.subscribe(Permission.Event.Asked).pipe(
          Stream.runForEach((event) => Queue.offer(requested, event.data)),
          Effect.forkScoped({ startImmediately: true }),
        )
        const running = yield* executeTool(tools, {
          sessionID: session.id,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-monitor-denied",
            name: "monitor",
            input: {
              command:
                process.platform === "win32"
                  ? "Set-Content must-not-exist forbidden"
                  : "printf forbidden > must-not-exist",
              description: "Permission denial test",
            },
          },
        }).pipe(Effect.forkScoped)

        const request = yield* Queue.take(requested)
        expect(request).toMatchObject({ action: "shell", sessionID: session.id })
        expect(yield* shell.list()).toEqual([])
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
        yield* permission.reply({ requestID: request.id, reply: "reject" })
        const exit = yield* Fiber.await(running)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(
            exit.cause.reasons.some(
              (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
            ),
          ).toBe(true)
        expect(yield* monitors.list(session.id)).toEqual([])
        expect(yield* shell.list()).toEqual([])
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      }).pipe(Effect.provide(locations.get(location)), Effect.ensuring(locations.invalidate(location)))
    }).pipe(Effect.timeout("5 seconds")),
  )
})
