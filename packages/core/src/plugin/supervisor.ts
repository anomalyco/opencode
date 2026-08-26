export * as PluginSupervisor from "./supervisor.js"
export { Service, type Interface, noUpdates } from "./supervisor-service.js"

import type { Plugin as PluginDefinition } from "@opencode-ai/plugin/effect/plugin"
import { Event } from "@opencode-ai/schema/config"
import { Cause, Effect, Latch, Layer, Schema, Semaphore, Stream } from "effect"
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
      ...[...packages.values()].filter((plugin) => enabled.has(plugin.id)),
      ...post.filter((plugin) => enabled.has(plugin.id)),
    ],
    failures: [...failures.values()],
  }
})

const load = Effect.fn("PluginSupervisor.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
) {
  const npm = yield* Npm.Service
  const local = path.isAbsolute(operation.target)
  const installed = local
    ? { entrypoint: pathToFileURL(operation.target).href, revision: operation.mtime?.toString() }
    : yield* npm.add(operation.target, { subpaths: ["server", ""] })
  const entrypoint = installed.entrypoint
  if (!entrypoint) return yield* Effect.fail(new Error(`Plugin entrypoint not found: ${operation.target}`))
  // Bun currently ignores query parameters when caching file:// imports.
  const source = local
    ? operation.mtime === undefined
      ? entrypoint
      : typeof Bun !== "undefined"
        ? `${operation.target.replaceAll("\\", "/")}?mtime=${operation.mtime}`
        : `${entrypoint}?mtime=${operation.mtime}`
    : installed.revision
      ? `${entrypoint}?revision=${encodeURIComponent(installed.revision)}`
      : entrypoint
  yield* Effect.log({ msg: "loading plugin", local })
  const mod = yield* Effect.promise(() => importModule(source))
  const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    tui: plugin.tui,
    version: `${JSON.stringify(operation)}:${installed.revision ?? ""}`,
    source: pluginSource(operation.target),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Plugin.Versioned
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const npm = yield* Npm.Service
    const sdk = yield* SdkPlugins.Service
    const sources = yield* ConfigPluginSource.Service
    const bus = yield* Bus.Service
    const ready = yield* Latch.make()
    const activationLock = Semaphore.makeUnsafe(1)
    const internal = yield* PluginInternal.list()
    let observed = 0

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
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
    const checkOne = Effect.fn("PluginSupervisor.checkOne")(function* (info: Plugin.Info) {
      const name = pluginName(info)
      if (info.source.type !== "package") {
        return { name, source: info.source, status: "not-updateable" } satisfies Plugin.UpdateInfo
      }
      const source = info.source
      return yield* npm.check(source.package).pipe(
        Effect.map(
          (update): Plugin.UpdateInfo => ({
            name,
            source: info.source,
            status: update.pinned
              ? "pinned"
              : !update.updateable
                ? "not-updateable"
                : update.updateAvailable
                  ? "available"
                  : "up-to-date",
            currentVersion: update.currentVersion,
            latestVersion: update.latestVersion,
          }),
        ),
        Effect.catchCause(() =>
          Effect.succeed({
            name,
            source: info.source,
            status: "failed",
            error: "Failed to check plugin update",
          } satisfies Plugin.UpdateInfo),
        ),
      )
    })
    const check = Effect.fn("PluginSupervisor.check")(function* () {
      return yield* Effect.forEach(yield* registry.list(), checkOne, { concurrency: "unbounded" })
    })
    const updateOne = Effect.fn("PluginSupervisor.updateOne")(function* (info: Plugin.Info) {
      const name = pluginName(info)
      if (info.source.type !== "package") {
        return { name, source: info.source, status: "not-updateable" } satisfies Plugin.UpdateResult
      }
      const source = info.source
      return yield* npm.update(source.package).pipe(
        Effect.map(
          (update): Plugin.UpdateResult => ({
            name,
            source: info.source,
            status: update.pinned
              ? "pinned"
              : !update.updateable
                ? "not-updateable"
                : update.updated
                  ? "updated"
                  : "up-to-date",
            previousVersion: update.previousVersion,
            version: update.latestVersion ?? update.currentVersion,
          }),
        ),
        Effect.catchCause(() =>
          Effect.succeed({
            name,
            source: info.source,
            status: "failed",
            error: "Failed to update plugin",
          } satisfies Plugin.UpdateResult),
        ),
      )
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
    const reload = (packages: readonly string[]) =>
      activationLock.withPermit(
        Effect.gen(function* () {
          yield* activate().pipe(Effect.scoped, Effect.provideService(Npm.Service, npm))
          const failed = (yield* registry.list()).flatMap((info) =>
            info.status === "failed" && info.source.type === "package" && packages.includes(info.source.package)
              ? [info.source.package]
              : [],
          )
          if (failed.length === 0) return failed
          yield* Effect.forEach(failed, (pkg) =>
            npm
              .rollback(pkg)
              .pipe(
                Effect.catchCause((cause) => Effect.logError("failed to restore plugin package revision", { cause })),
              ),
          )
          yield* activate().pipe(Effect.scoped, Effect.provideService(Npm.Service, npm))
          return failed
        }),
      )
    yield* Stream.concat(Stream.succeed(0), updates).pipe(
      // Keep observing updates while activation runs, retaining only the latest generation request.
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.debounce("100 millis"),
      Stream.runForEach((target) =>
        Effect.gen(function* () {
          yield* activationLock.withPermit(activate())
          if (observed === target) yield* ready.open
        }).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      flush: ready.await,
      check,
      update: Effect.fn("PluginSupervisor.update")(function* (name) {
        const info = (yield* registry.list()).find((info) => pluginName(info) === name || info.id === name)
        if (!info) {
          return {
            name,
            source: { type: "package", package: name },
            status: "failed",
            error: "Plugin not found",
          }
        }
        const result = yield* updateOne(info)
        if (result.status === "updated" && result.source.type === "package") {
          const failed = yield* reload([result.source.package])
          if (failed.length > 0)
            return { ...result, status: "failed" as const, error: "Updated plugin failed to activate" }
        }
        return result
      }),
      updateAll: Effect.fn("PluginSupervisor.updateAll")(function* () {
        const results = yield* Effect.forEach(yield* registry.list(), updateOne)
        const packages = results.flatMap((result) =>
          result.status === "updated" && result.source.type === "package" ? [result.source.package] : [],
        )
        if (packages.length === 0) return results
        const failed = yield* reload(packages)
        return results.map((result) => {
          if (result.source.type !== "package" || !failed.includes(result.source.package)) return result
          return { ...result, status: "failed" as const, error: "Updated plugin failed to activate" }
        })
      }),
    })
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

function pluginName(info: Plugin.Info) {
  if (info.source.type === "package") return info.source.package
  if (info.source.type === "local") return info.source.path
  return info.id ?? info.source.type
}

export const node = makeLocationNode({ service: Service, layer, deps: nodeDeps })
