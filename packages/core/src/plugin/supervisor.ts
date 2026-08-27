export * as PluginSupervisor from "./supervisor.js"
export { Service, type Interface } from "./supervisor-service.js"

import { Event } from "@opencode-ai/schema/config"
import { Effect, Latch, Layer, Stream } from "effect"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Plugin } from "../plugin.js"
import { PluginDiscovery } from "./discovery.js"
import { PluginInternal } from "./internal.js"
import { SdkPlugins } from "./sdk.js"
import { Service } from "./supervisor-service.js"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const sources = yield* ConfigPluginSource.Service
    const discovery = yield* PluginDiscovery.Service
    const bus = yield* Bus.Service
    const ready = yield* Latch.make()
    let observed = 0

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
      // Resolve OpenCode's internal plugins with their privileged Location services.
      const internal = yield* PluginInternal.list()
      // Combine internal plugins with host-contributed SDK plugins in boot order.
      const pre = [
        ...internal.pre.map((plugin) => ({ ...plugin, version: "internal", source: { type: "builtin" as const } })),
        ...sdk.all(),
      ]
      const post = internal.post.map((plugin) => ({
        ...plugin,
        version: "internal",
        source: { type: "builtin" as const },
      }))
      const operations = yield* sources.operations()
      // Apply config operations and load enabled package plugins into one ordered generation.
      const resolved = yield* discovery.resolve(pre, post, operations)
      // Replace the active generation in one scoped, batched activation.
      yield* registry.activate(resolved.plugins, resolved.failures)
    })
    const updates = Stream.merge(sources.changes(), bus.subscribe([Event.Updated, SdkPlugins.Updated])).pipe(
      // Make accepted work visible to flush before coalescing the burst.
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          observed++
          yield* ready.close
          return observed
        }),
      ),
    )
    yield* Stream.concat(Stream.succeed(0), updates).pipe(
      // Keep observing updates while activation runs, retaining only the latest generation request.
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.debounce("100 millis"),
      Stream.runForEach((target) =>
        Effect.gen(function* () {
          yield* activate()
          if (observed === target) yield* ready.open
        }).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ flush: ready.await })
  }),
)

const nodeDeps = [
  Plugin.node,
  SdkPlugins.node,
  ConfigPluginSource.node,
  Bus.node,
  PluginDiscovery.node,
  PluginInternal.requirements,
] as const

export const node = makeLocationNode({ service: Service, layer, deps: nodeDeps })
