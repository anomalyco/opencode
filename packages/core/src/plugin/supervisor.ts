export * as PluginSupervisor from "./supervisor.js"
export { Service, type Interface } from "./supervisor-service.js"

import { Event } from "@opencode-ai/schema/config"
import { Cause, Effect, Latch, Layer, Stream } from "effect"
import path from "path"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Npm } from "@opencode-ai/util/npm"
import { Plugin } from "../plugin.js"
import { InstancePlugins } from "./instance.js"
import { PluginInternal } from "./internal.js"
import { PluginModule } from "./module.js"
import { SdkPlugins } from "./sdk.js"
import { Service } from "./supervisor-service.js"

const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  pre: readonly Plugin.Versioned[],
  post: readonly Plugin.Versioned[],
  operations: readonly ConfigPluginSource.Operation[],
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const packages = new Map<string, Plugin.Versioned>()
  const failures = new Map<string, Extract<Plugin.Info, { readonly status: "failed" }>>()
  const plugins = () => [...definitions, ...packages.values()]

  for (const operation of operations) {
    if (operation.type === "remove") {
      if (operation.target === "*") failures.clear()
      plugins()
        .filter((plugin) => matches(operation.target, plugin.id))
        .forEach((plugin) => enabled.delete(plugin.id))
      continue
    }

    const matched = plugins().filter((plugin) => matches(operation.target, plugin.id))
    const selectsPlugins =
      matched.length > 0 ||
      operation.target === "*" ||
      operation.target.endsWith(".*") ||
      operation.target.startsWith("opencode.")
    if (selectsPlugins) {
      matched.forEach((plugin) => enabled.add(plugin.id))
      continue
    }

    const plugin = yield* PluginModule.load(operation).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to load plugin", { target: operation.target, cause }).pipe(
          Effect.as({ error: Cause.pretty(cause) }),
        ),
      ),
    )
    if ("error" in plugin) {
      failures.set(operation.target, {
        source: pluginSource(operation.target),
        status: "failed",
        error: plugin.error,
        tui: false,
      })
      continue
    }
    failures.delete(operation.target)
    const previous = packages.get(operation.target)
    if (previous) enabled.delete(previous.id)
    packages.set(operation.target, plugin)
    enabled.add(plugin.id)
  }

  return {
    plugins: [
      ...pre.filter((plugin) => enabled.has(plugin.id)),
      ...[...packages.values()].filter((plugin) => enabled.has(plugin.id)),
      ...post.filter((plugin) => enabled.has(plugin.id)),
    ],
    failures: [...failures.values()],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const instance = yield* InstancePlugins.Service
    const sources = yield* ConfigPluginSource.Service
    const bus = yield* Bus.Service
    const ready = yield* Latch.make()
    let observed = 0

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
      // Resolve OpenCode's internal plugins with their privileged Location services.
      const internal = yield* PluginInternal.list()
      // Combine internal plugins with host-contributed plugins in boot order.
      // Instance-bound plugins come last: later activation can override earlier
      // container writes, so the instance's explicit choices win over globals.
      const pre = [
        ...internal.pre.map((plugin) => ({ ...plugin, version: "internal", source: { type: "builtin" as const } })),
        ...sdk.all(),
        ...instance.all(),
      ]
      const post = internal.post.map((plugin) => ({
        ...plugin,
        version: "internal",
        source: { type: "builtin" as const },
      }))
      const operations = yield* sources.operations()
      // Apply config operations and load enabled package plugins into one ordered generation.
      const resolved = yield* resolve(pre, post, operations)
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
          yield* activate().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause })))
          if (observed === target) yield* ready.open
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ flush: ready.await })
  }),
)

const nodeDeps = [
  Plugin.node,
  SdkPlugins.node,
  InstancePlugins.node,
  ConfigPluginSource.node,
  Bus.node,
  Npm.node,
  PluginInternal.requirements,
] as const

function pluginSource(target: string): Plugin.Source {
  if (path.isAbsolute(target)) return { type: "local", path: target }
  return { type: "package", package: target }
}

export const node = makeLocationNode({ service: Service, layer, deps: nodeDeps })
