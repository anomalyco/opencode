import { describe, expect, test } from "bun:test"
import { Context, Effect, Exit, Layer, Option, Scope } from "effect"
import { Node } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { Plugin } from "@opencode-ai/plugin/effect"
import { Agent } from "../src/agent"
import { App } from "../src/app"
import { Bus } from "../src/bus"
import { Config } from "../src/config"
import { Instance } from "../src/instance"
import { InstructionDiscovery } from "../src/instruction-discovery"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { ModelsDev } from "../src/models-dev"
import { InstancePlugins } from "../src/plugin/instance"
import { PluginRuntime } from "../src/plugin/runtime"
import { PluginSupervisor } from "../src/plugin/supervisor"
import { Project } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { Watcher } from "../src/filesystem/watcher"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

class Extra extends Context.Service<Extra, string>()("test/InstanceExtraGlobal") {}

describe("Instance.compose", () => {
  it.live("reuses configured globals across fresh, separately bound local graphs", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const acquired = { global: 0, app: 0, project: 0, runtime: 0 }
      const released = { global: 0 }
      const profile = [
        [
          Global.node,
          Layer.effectContext(
            Effect.gen(function* () {
              acquired.global++
              yield* Effect.addFinalizer(() => Effect.sync(() => released.global++))
              return yield* Layer.build(tempGlobalLayer)
            }),
          ),
        ],
        [
          App.node,
          Layer.effect(
            App.Metadata,
            Effect.sync(() => {
              acquired.app++
              return App.make({ name: "compose-host", version: "test" })
            }),
          ),
        ],
        [ModelsDev.node, ModelsDev.configured({ fetch: false })],
        [Watcher.node, Watcher.configured({ enabled: false })],
      ] as const
      const replacements = [
        ...profile,
        [
          Project.node,
          Layer.effectContext(
            Effect.gen(function* () {
              acquired.project++
              return yield* Layer.build(LayerNode.compile(Project.node, profile))
            }),
          ),
        ],
      ] as const
      const owner = yield* Effect.scope
      const sharedScope = yield* Scope.fork(owner)
      const memoMap = yield* Layer.makeMemoMap
      const globals = yield* Layer.buildWithMemoMap(
        LayerNode.compile(Instance.globalsGraph, replacements),
        memoMap,
        sharedScope,
      )
      expect(acquired).toEqual({ global: 1, app: 1, project: 1, runtime: 0 })
      expect(Option.isNone(yield* Effect.serviceOption(LocationServiceMap.Service).pipe(Effect.provide(globals)))).toBe(
        true,
      )

      const plugin = Plugin.define({
        id: "compose-plugin",
        effect: (ctx) => ctx.agent.transform((agents) => agents.update(Agent.ID.make("compose-agent"), () => {})),
      })
      const ref = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const local = [
        ...replacements,
        [
          Config.node,
          Config.configured({ project: false, global: false, content: JSON.stringify({ shell: "compose-shell" }) }),
        ],
        [InstructionDiscovery.node, InstructionDiscovery.configured({ project: true, global: false })],
        [
          Location.node,
          Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make("/") }), { discovery: false }),
        ],
        [InstancePlugins.node, InstancePlugins.bound([plugin])],
      ] as const
      const build = (scope: Scope.Scope, plugins: InstancePlugins.List) =>
        Layer.buildWithMemoMap(
          Instance.compose(ref, {
            discovery: false,
            plugins,
            replacements: [
              ...local,
              [
                PluginRuntime.node,
                Layer.effectContext(
                  Effect.gen(function* () {
                    acquired.runtime++
                    return yield* Layer.build(PluginRuntime.layerWithCell(PluginRuntime.makeCell()))
                  }),
                ),
              ],
            ],
          }).pipe(Layer.provide(Layer.succeedContext(globals))),
          memoMap,
          scope,
        )
      const firstScope = yield* Scope.fork(owner)
      const secondScope = yield* Scope.fork(owner)
      const first = yield* build(firstScope, [plugin])
      const second = yield* build(secondScope, [])
      yield* Context.get(first, PluginSupervisor.Service).flush
      yield* Context.get(second, PluginSupervisor.Service).flush

      expect(acquired).toEqual({ global: 1, app: 1, project: 1, runtime: 2 })
      expect(Context.get(first, Location.Service).directory).toBe(ref.directory)
      expect(Context.get(second, Location.Service).directory).toBe(ref.directory)
      expect(Context.get(first, Config.Service)).not.toBe(Context.get(second, Config.Service))
      expect(Context.get(first, Agent.Service)).not.toBe(Context.get(second, Agent.Service))
      expect(Config.latest(yield* Context.get(first, Config.Service).entries(), "shell")).toBe("compose-shell")
      expect(Context.get(first, InstructionDiscovery.Service).project).toBe(true)
      expect(
        Context.get(first, InstancePlugins.Service)
          .all()
          .map((item) => item.id),
      ).toEqual([plugin.id])
      expect(Context.get(second, InstancePlugins.Service).all()).toEqual([])
      expect(yield* Context.get(first, Agent.Service).get(Agent.ID.make("compose-agent"))).toBeDefined()
      expect(yield* Context.get(second, Agent.Service).get(Agent.ID.make("compose-agent"))).toBeUndefined()

      yield* Scope.close(firstScope, Exit.void)
      expect(released.global).toBe(0)
      expect((yield* Context.get(second, Agent.Service).list()).length).toBeGreaterThan(0)
      yield* Context.get(globals, Project.Service).list()
      yield* Scope.close(secondScope, Exit.void)
      yield* Scope.close(sharedScope, Exit.void)
      expect(released.global).toBe(1)
    }),
  )

  test("rejects globals introduced by a local replacement instead of acquiring them fresh", () => {
    const extra = Node.makeGlobalNode({ service: Extra, layer: Layer.succeed(Extra, "extra"), deps: [] })
    const discovery = Node.makeLocationNode({
      service: InstructionDiscovery.Service,
      layer: InstructionDiscovery.layer().pipe(Layer.tap(() => Extra)),
      deps: [Bus.node, extra],
    })
    expect(() =>
      Instance.compose(Location.Ref.make({ directory: AbsolutePath.make("/") }), {
        replacements: [[InstructionDiscovery.node, discovery]],
      }),
    ).toThrow("Unsupported instance globals: test/InstanceExtraGlobal")
  })

  test("also checks shared dependencies of a per-instance runtime replacement", () => {
    const extra = Node.makeGlobalNode({ service: Extra, layer: Layer.succeed(Extra, "extra"), deps: [] })
    const runtime = Node.makeGlobalNode({
      service: PluginRuntime.Service,
      layer: PluginRuntime.layerWithCell(PluginRuntime.makeCell()).pipe(Layer.tap(() => Extra)),
      deps: [extra],
    })
    expect(() =>
      Instance.compose(Location.Ref.make({ directory: AbsolutePath.make("/") }), {
        replacements: [[PluginRuntime.node, runtime]],
      }),
    ).toThrow("Unsupported instance globals: test/InstanceExtraGlobal")
  })
})
