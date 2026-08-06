export * as PluginSupervisor from "./supervisor"

import type { Plugin as PluginDefinition } from "@opencode-ai/plugin/effect/plugin"
import { Event } from "@opencode-ai/schema/config"
import { Context, Deferred, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Agent } from "../agent"
import { Catalog } from "../catalog"
import { Command } from "../command"
import { Config } from "../config"
import { ConfigPlugin } from "../config/plugin"
import { Credential } from "../credential"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Bus } from "../bus"
import { FileMutation } from "../file-mutation"
import { Formatter } from "../formatter"
import { FileSystem } from "../filesystem"
import { Watcher } from "../filesystem/watcher"
import { Form } from "../form"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Image } from "../image"
import { Integration } from "../integration"
import { KV } from "../kv"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "@opencode-ai/util/npm"
import { Permission } from "../permission"
import { Plugin } from "../plugin"
import { PluginPromise } from "../plugin/promise"
import { Reference } from "../reference"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { Shell } from "../shell"
import { Skill } from "../skill"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { Tool } from "../tool"
import { WebSearch } from "../websearch"
import { WellKnown } from "../wellknown"
import { PluginInternal } from "./internal"
import { PluginRuntime } from "./runtime"
import { SdkPlugins } from "./sdk"
import { importModule } from "@opencode-ai/util/runtime-import"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<PluginDefinition["effect"]>(
        (input): input is PluginDefinition["effect"] => typeof input === "function",
      ),
    }),
    Schema.Struct({
      id: Schema.String,
      setup: Schema.declare<Parameters<typeof PluginPromise.fromPromise>[0]["setup"]>(
        (input): input is Parameters<typeof PluginPromise.fromPromise>[0]["setup"] => typeof input === "function",
      ),
    }),
  ]),
})

type Operation =
  | {
      readonly type: "add"
      readonly target: string
      readonly options: Record<string, unknown>
      readonly mtime?: number
    }
  | {
      readonly type: "remove"
      readonly target: string
    }

function parse(input: ConfigPlugin.Plugin): Operation {
  if (typeof input !== "string") {
    return { type: "add", target: input.package, options: input.options ?? {} }
  }
  if (!input.startsWith("-")) return { type: "add", target: input, options: {} }
  if (input.length === 1) throw new Error("Plugin remove operation requires a target")
  return { type: "remove", target: input.slice(1) }
}

const scan = Effect.fn("PluginSupervisor.scan")(function* (entries: readonly Config.Entry[]) {
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  const discovered = yield* Effect.forEach(
    entries.filter((entry): entry is Config.Directory => entry.type === "directory"),
    (entry) => discoverDirectory(fs, entry.path),
  ).pipe(Effect.map((items) => items.flat()))
  const configured = entries
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) =>
      (entry.info.plugins ?? []).map(parse).map((operation) => {
        if (operation.type === "remove") return operation
        const directory = entry.path ? path.dirname(entry.path) : location.directory
        const target = operation.target.startsWith("file://")
          ? fileURLToPath(operation.target)
          : operation.target.startsWith("./") || operation.target.startsWith("../")
            ? path.resolve(directory, operation.target)
            : operation.target
        return { ...operation, target }
      }),
    )
  // Explicit config is applied last so it can remove auto-discovered packages.
  return yield* Effect.forEach([...discovered, ...configured], (operation) => {
    if (operation.type === "remove" || !path.isAbsolute(operation.target)) return Effect.succeed(operation)
    return fs.stat(operation.target).pipe(
      Effect.map((info) => ({
        ...operation,
        mtime: Option.getOrElse(info.mtime, () => new Date(0)).getTime(),
      })),
      Effect.catch(() => Effect.succeed(operation)),
    )
  })
})

const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  pre: readonly Plugin.Versioned[],
  post: readonly Plugin.Versioned[],
  operations: readonly Operation[],
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const packages = new Map<string, Plugin.Versioned>()
  const plugins = () => [...definitions, ...packages.values()]

  for (const operation of operations) {
    if (operation.type === "remove") {
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
        Effect.logWarning("failed to load plugin", { target: operation.target, cause }).pipe(Effect.as(undefined)),
      ),
    )
    if (!plugin) continue
    const previous = packages.get(operation.target)
    if (previous) enabled.delete(previous.id)
    packages.set(operation.target, plugin)
    enabled.add(plugin.id)
  }

  return [
    ...pre.filter((plugin) => enabled.has(plugin.id)),
    ...Array.from(packages.values()).filter((plugin) => enabled.has(plugin.id)),
    ...post.filter((plugin) => enabled.has(plugin.id)),
  ]
})

const load = Effect.fn("PluginSupervisor.load")(function* (operation: Extract<Operation, { type: "add" }>) {
  const npm = yield* Npm.Service
  const entrypoint = path.isAbsolute(operation.target)
    ? pathToFileURL(operation.target).href
    : (yield* npm.add(operation.target, { subpaths: ["server", ""] })).entrypoint
  if (!entrypoint) return
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
    version: JSON.stringify(operation),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Plugin.Versioned
})

function discoverDirectory(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const files = yield* fs
      .scan("{plugin,plugins}/*.{ts,js}", {
        cwd: directory,
        absolute: true,
        include: "file",
        dot: true,
        symlink: true,
      })
      .pipe(Effect.orElseSucceed(() => []))
    return files.sort().map((target): Operation => ({ type: "add", target, options: {} }))
  })
}

const sourceDirectories = ["plugin", "plugins"] as const

function isPluginSource(entries: readonly Config.Entry[], file: string) {
  return entries.some(
    (entry) =>
      entry.type === "directory" &&
      sourceDirectories.some((directory) => FSUtil.contains(path.join(entry.path, directory), file)),
  )
}

export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const watcher = yield* Watcher.Service
    const fs = yield* FSUtil.Service
    const ready = yield* Deferred.make<void>()
    let observed = 0

    // Configured local plugin files can live outside config roots, where the
    // config change feed cannot see them; watch those entrypoints directly.
    // Watches start on first sighting and are never torn down individually:
    // a stale watch after a config edit costs one deduped fs handle and a
    // no-op activation, and every watch dies with this layer's scope.
    const configuredChanges = yield* PubSub.unbounded<void>()
    const watched = new Set<string>()
    const watchConfiguredSources = Effect.fn("PluginSupervisor.watchConfiguredSources")(function* (
      entries: readonly Config.Entry[],
      operations: readonly Operation[],
    ) {
      for (const operation of operations) {
        if (operation.type !== "add" || !path.isAbsolute(operation.target)) continue
        if (watched.has(operation.target)) continue
        // The config change feed already covers {plugin,plugins} directories.
        if (isPluginSource(entries, operation.target)) continue
        // Directory targets can't hot-reload (their stat mtime ignores edits
        // inside), so don't watch what can't trigger anything.
        if (yield* fs.isDir(operation.target)) continue
        watched.add(operation.target)
        const updates = yield* watcher.subscribe({ path: operation.target, type: "file" })
        yield* updates.pipe(
          Stream.runForEach(() => PubSub.publish(configuredChanges, undefined)),
          Effect.catchCause((cause) =>
            Effect.logError("configured plugin watch failed", { target: operation.target, cause }),
          ),
          Effect.forkScoped({ startImmediately: true }),
        )
      }
    })

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
      // Resolve OpenCode's internal plugins with their privileged Location services.
      const internal = yield* PluginInternal.list()
      // Combine internal plugins with host-contributed SDK plugins in boot order.
      const pre = [...internal.pre.map((plugin) => ({ ...plugin, version: "internal" })), ...sdk.all()]
      const post = internal.post.map((plugin) => ({ ...plugin, version: "internal" }))
      const entries = yield* config.entries()
      const operations = yield* scan(entries)
      yield* watchConfiguredSources(entries, operations)
      // Apply config operations and load enabled package plugins into one ordered generation.
      const plugins = yield* resolve(pre, post, operations)
      // Replace the active generation in one scoped, batched activation.
      yield* registry.activate(plugins)
    })
    const updates = Stream.merge(
      config.changes().pipe(
        Stream.filterEffect((update) => Effect.map(config.entries(), (entries) => isPluginSource(entries, update.path))),
        Stream.merge(Stream.fromPubSub(configuredChanges)),
      ),
      bus.subscribe([Event.Updated, SdkPlugins.Updated]),
    ).pipe(
      // Make accepted work visible to flush before coalescing the burst.
      Stream.mapEffect(() => Effect.sync(() => ++observed)),
    )
    yield* Stream.concat(Stream.succeed(0), updates).pipe(
      // Keep observing updates while activation runs, retaining only the latest generation request.
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.debounce("100 millis"),
      Stream.runForEach((target) =>
        Effect.gen(function* () {
          yield* activate()
          if (observed === target) yield* Deferred.succeed(ready, undefined)
        }).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ flush: Deferred.await(ready) })
  }),
)

const nodeLayer = layer as Layer.Layer<Service, never, PluginInternal.Requirements>

export const node = makeLocationNode({
  service: Service,
  layer: nodeLayer,
  deps: [
    Plugin.node,
    SdkPlugins.node,
    Agent.node,
    Catalog.node,
    Command.node,
    Config.node,
    Credential.node,
    Bus.node,
    FileMutation.node,
    Formatter.node,
    FileSystem.node,
    FSUtil.node,
    Global.node,
    httpClient,
    Image.node,
    Integration.node,
    KV.node,
    Location.node,
    LocationMutation.node,
    ModelsDev.node,
    Npm.node,
    Permission.node,
    PluginRuntime.node,
    Form.node,
    ReadToolFileSystem.node,
    Reference.node,
    Ripgrep.node,
    SessionInstructions.node,
    Shell.node,
    Skill.node,
    Tool.node,
    Watcher.node,
    WebSearch.node,
    WellKnown.node,
  ],
})

export { layer }
