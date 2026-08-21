export * as PluginSupervisor from "./supervisor.js"
export { Service, type Interface } from "./supervisor-service.js"

import type { Plugin as PluginDefinition } from "@opencode-ai/plugin/effect/plugin"
import { Event } from "@opencode-ai/schema/config"
import { Cause, Effect, Latch, Layer, Schema, Stream } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Npm } from "@opencode-ai/util/npm"
import { Plugin } from "../plugin.js"
import { PluginPromise } from "../plugin/promise.js"
import { PluginInternal } from "./internal.js"
import { SdkPlugins } from "./sdk.js"
import { importModule } from "@opencode-ai/util/runtime-import"
import { Service } from "./supervisor-service.js"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      tui: Schema.optional(Schema.Boolean),
      effect: Schema.declare<PluginDefinition["effect"]>(
        (input): input is PluginDefinition["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      tui: Schema.optional(Schema.Boolean),
      setup: Schema.declare<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>(
        (input): input is Parameters<typeof PluginPromise.fromPromise>[0]["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

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

    const plugin = yield* load(operation).pipe(
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
      ...Array.from(packages.values()).filter((plugin) => enabled.has(plugin.id)),
      ...post.filter((plugin) => enabled.has(plugin.id)),
    ],
    failures: [...failures.values()],
  }
})

const load = Effect.fn("PluginSupervisor.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
) {
  const npm = yield* Npm.Service
  const entrypoint = path.isAbsolute(operation.target)
    ? pathToFileURL(operation.target).href
    : (yield* npm.add(operation.target, { subpaths: ["server", ""] })).entrypoint
  if (!entrypoint) return yield* Effect.fail(new Error(`Plugin entrypoint not found: ${operation.target}`))
  // Bun currently ignores query parameters when caching file:// imports.
  const source =
    operation.mtime === undefined
      ? entrypoint
      : typeof Bun !== "undefined"
        ? `${operation.target.replaceAll("\\", "/")}?mtime=${operation.mtime}`
        : `${entrypoint}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => importModule(source))
  const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    tui: plugin.tui,
    version: JSON.stringify(operation),
    source: pluginSource(operation.target),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Plugin.Versioned
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const sources = yield* ConfigPluginSource.Service
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
  Npm.node,
  PluginInternal.requirements,
] as const

function pluginSource(target: string): Plugin.Source {
  if (path.isAbsolute(target)) return { type: "local", path: target }
  return { type: "package", package: target }
}

export const node = makeLocationNode({ service: Service, layer, deps: nodeDeps })
