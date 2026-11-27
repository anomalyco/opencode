import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Stream } from "effect"
import { Config } from "@opencode/core/config"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { PluginHost } from "@opencode/core/plugin/host"
import { ArtifactTools } from "@opencode/core/tool/plugin/artifact"
import { AutomationTools } from "@opencode/core/tool/plugin/automation"
import { ImageGenerateTool } from "@opencode/core/tool/plugin/image-generate"
import { VideoGenerateTool } from "@opencode/core/tool/plugin/video-generate"
import { WebSearchTool } from "@opencode/core/tool/plugin/websearch"
import { SessionInterruptTool } from "@opencode/core/tool/plugin/session-interrupt"
import { PluginTestLayer } from "./fixture"
import { drain } from "../lib/clock"
import { App } from "@opencode/core/app"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Instance } from "@opencode/core/instance"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { Bus } from "../../src/bus"
import { Database } from "../../src/database/database"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { toolDefinitions } from "../lib/tool"

const unexpected = (pkg: string) =>
  Effect.fail(new Npm.InstallFailedError({ add: [pkg], dir: "", cause: new Error(`Unexpected Npm call: ${pkg}`) }))

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LocationServiceMap.make(
      (ref: Location.Ref) => Instance.layer(ref, { discovery: false, replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      App.node.replace(App.configured({ channel: "dev" })),
      Global.node.replace(tempGlobalLayer),
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
            follows: () => Effect.succeed(false),
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

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

describe("PluginInternal flags", () => {
  it.live("turns flagged built-in tools on for a dev-channel server with no config while keeping todo off", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const { registered, direct } = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        const tools = yield* Tool.Service
        return {
          registered: (yield* tools.list()).map((tool) => tool.id),
          direct: (yield* toolDefinitions(tools)).map((definition) => definition.name),
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )

      expect(registered).toContain("opencode_artifact_create")
      expect(registered).toContain("shell")
      expect(registered).not.toContain(TodoTool.name)
      expect(direct).not.toContain("shell")
    }).pipe(Effect.provideService(Flag.Overrides, undefined)),
  )
})

const reactive = testEffect(PluginTestLayer)

describe("Flag-driven tool reloads", () => {
  reactive.effect("ignores unrelated edits and rebuilds all flag-gated tools once per changed snapshot", () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const host = yield* PluginHost.make(plugins, "test")
      const tools = yield* Tool.Service
      const config = yield* Config.Test
      const bus = yield* Bus.Service
      yield* TodoTool.Plugin.effect(host)
      yield* ArtifactTools.Plugin.effect(host)
      yield* WebSearchTool.Plugin.effect(host)
      yield* SessionInterruptTool.Plugin.effect(host)
      yield* ImageGenerateTool.Plugin.effect(host)
      yield* VideoGenerateTool.Plugin.effect(host)
      yield* AutomationTools.Plugin.effect(host)
      const builds = { count: 0 }
      yield* tools.transform(() => {
        builds.count++
      })
      yield* drain
      const initial = builds.count
      expect((yield* tools.list()).map((tool) => tool.id)).not.toContain(TodoTool.name)
      expect((yield* toolDefinitions(tools)).map((tool) => tool.name)).toContain("websearch")

      yield* config.setEntries([new Document({ type: "document", info: new Info({ shell: "/bin/sh" }) })])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(builds.count).toBe(initial)

      yield* config.setEntries([
        new Document({
          type: "document",
          info: new Info({
            experimental: new ConfigExperimental.Info({ todo: true, artifacts: true, full_codemode: true }),
          }),
        }),
      ])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(builds.count).toBe(initial + 1)
      expect((yield* tools.list()).map((tool) => tool.id)).toContain(TodoTool.name)
      expect((yield* tools.list()).map((tool) => tool.id)).toContain("opencode_artifact_create")
      expect((yield* toolDefinitions(tools)).map((tool) => tool.name)).not.toContain("websearch")

      yield* config.setEntries([])
      yield* bus.publish(Event.Updated, {})
      yield* drain
      expect(builds.count).toBe(initial + 2)
      expect((yield* tools.list()).map((tool) => tool.id)).not.toContain(TodoTool.name)
      expect((yield* toolDefinitions(tools)).map((tool) => tool.name)).toContain("websearch")
    }).pipe(Effect.provideService(Flag.Overrides, undefined)),
  )
})
