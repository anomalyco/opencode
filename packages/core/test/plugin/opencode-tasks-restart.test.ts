import { describe, expect } from "bun:test"
import path from "path"
import { Duration, Effect, Layer, LayerMap, Stream } from "effect"
import { Agent } from "@opencode/core/agent"
import { App } from "@opencode/core/app"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationPin } from "@opencode/core/location-pin"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { OpencodeTasks } from "@opencode/core/plugin/provider/opencode-tasks"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Bus } from "../../src/bus"
import { Database } from "../../src/database/database"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { eventually } from "../lib/eventually"
import { testEffect } from "../lib/effect"

const unexpected = (pkg: string) =>
  Effect.fail(new Npm.InstallFailedError({ add: [pkg], dir: "", cause: new Error(`Unexpected Npm call: ${pkg}`) }))

/** A server process: real Locations with the built-in plugins, over one data directory that outlives it. */
function server(root: string) {
  const global = Global.layerWith({
    data: path.join(root, "data"),
    cache: path.join(root, "cache"),
    config: path.join(root, "config"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  })
  const instances = Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const map = yield* LayerMap.make(
        (ref: Location.Ref) => Instance.layer(ref, { discovery: false, replacements: bindings }),
        { idleTimeToLive: Duration.infinity },
      )
      const bindings: LayerNode.Replacements = [
        App.node.replace(App.configured({ channel: "dev" })),
        Global.node.replace(global),
        offlineModels,
        ConfigPluginSource.node.replace(
          Layer.succeed(
            ConfigPluginSource.Service,
            ConfigPluginSource.Service.of({ operations: () => Effect.succeed([]), changes: () => Stream.never }),
          ),
        ),
        Npm.node.replace(
          Layer.succeed(
            Npm.Service,
            Npm.Service.of({
              add: unexpected,
              resolve: (name) => Effect.succeed({ directory: "", name }),
              check: () => Effect.succeed(false),
              update: unexpected,
              reject: () => Effect.succeed(false),
              which: () => Effect.undefined,
            }),
          ),
        ),
        LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
        Instance.node.replace(
          Layer.succeed(Instance.Service, { provide: (session) => Effect.provide(map.get(session.location)) }),
        ),
      ]
      return map
    }),
  )
  return AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SdkPlugins.node,
      LocationServiceMap.node,
      LocationActivity.node,
      LocationPin.node,
      Credential.node,
      Session.node,
    ]),
    [
      Global.node.replace(global),
      Database.node.replace(Database.configured({ path: path.join(root, "opencode.db") })),
      Bus.node.replace(Bus.configured({ persist: true })),
      offlineModels,
      LocationServiceMap.node.replace(instances),
    ],
  )
}

/** Console's claim renewal, recording which sessions it renews. */
function fakeConsole() {
  const renewed: string[] = []
  const console = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/v2/config") return Response.json({})
      if (url.pathname !== OpencodeTasks.RENEW_PATH) return new Response("Not found", { status: 404 })
      renewed.push(((await request.json()) as { session: string }).session)
      return Response.json({ renewed: 1, leaseExpiresAt: null, leaseMinutes: 30 })
    },
  })
  return { console, renewed }
}

const it = testEffect(Layer.empty)

describe("Console task claims across a server restart", () => {
  it.live("renew at boot without any request for the claiming session's directory", () =>
    Effect.gen(function* () {
      const root = (yield* tmpdirScoped()).path
      const project = Location.Ref.make({ directory: AbsolutePath.make((yield* tmpdirScoped()).path) })
      const { console, renewed } = yield* Effect.acquireRelease(Effect.sync(fakeConsole), (fake) =>
        Effect.promise(() => fake.console.stop(true)),
      )

      // The first process signs in, and a session in the project claims a task through Console's MCP.
      const sessionID = yield* Effect.gen(function* () {
        const credentials = yield* Credential.Service
        yield* credentials.create({
          integrationID: Integration.ID.make("opencode"),
          value: Credential.Key.make({ type: "key", key: "secret", metadata: { server: console.url.origin } }),
        })
        const session = yield* (yield* Session.Service).create({ location: project })
        const locations = yield* LocationServiceMap.Service
        const pins = yield* LocationPin.Service
        yield* Effect.gen(function* () {
          yield* (yield* Plugin.Service).awaitActivation
          yield* (yield* PluginHooks.Service).trigger("tool", "execute.after", {
            tool: OpencodeTasks.CLAIM_TOOL,
            codemode: false,
            sessionID: session.id,
            agent: Agent.ID.make("build"),
            messageID: SessionMessage.ID.create(),
            id: Tool.CallID.make("call_claim"),
            input: {},
            status: "completed",
            result: { output: { id: "tsk_1", status: "in_progress", claimed_by_session: session.id } },
          })
        }).pipe(Effect.scoped, Effect.provide(locations.get(project)))
        yield* eventually(pins.pinned(project), (pinned) => pinned)
        return session.id
      }).pipe(Effect.scoped, Effect.provide(server(root)))
      expect(renewed).toEqual([])

      // The next process boots as the managed server does, and nothing asks for the project's directory.
      yield* Effect.gen(function* () {
        yield* (yield* LocationActivity.Service).resumePinned
        yield* eventually(
          Effect.sync(() => renewed),
          (sessions) => sessions.length > 0,
        )
      }).pipe(Effect.scoped, Effect.provide(server(root)))
      expect(renewed).toEqual([sessionID])
    }),
  )
})
