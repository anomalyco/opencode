export * as PluginSupervisor from "./supervisor"

import { Event } from "@opencode-ai/schema/config"
import { Context, Deferred, Effect, Fiber, Layer, Option, PubSub, Schema, Semaphore, Stream } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Agent } from "../agent"
import { Catalog } from "../catalog"
import { Command } from "../command"
import { Config } from "../config"
import { ConfigPlugin } from "../config/plugin"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { Bus } from "../bus"
import { FileMutation } from "../file-mutation"
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
      effect: Schema.declare<import("@opencode-ai/plugin/effect/plugin").Plugin["effect"]>(
        (input): input is import("@opencode-ai/plugin/effect/plugin").Plugin["effect"] => typeof input === "function",
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

const configuredOperations = Effect.fn("PluginSupervisor.configuredOperations")(function* (
  entries: readonly Config.Entry[],
  location: string,
) {
  const configured = entries
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => {
      const directory = entry.path ? path.dirname(entry.path) : location
      return (entry.info.plugins ?? []).map((input) => ({ directory, input }))
    })
  const operations = yield* Effect.forEach(configured, ({ directory, input }) =>
    Effect.sync(() => {
      const operation = parse(input)
      if (operation.type === "remove") return operation
      const target = operation.target.startsWith("file://")
        ? fileURLToPath(operation.target)
        : operation.target.startsWith("./") || operation.target.startsWith("../")
          ? path.resolve(directory, operation.target)
          : operation.target
      return { ...operation, target }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("invalid configured plugin target", { input, cause }).pipe(Effect.as(undefined)),
      ),
    ),
  )
  return operations.filter((operation): operation is Operation => operation !== undefined)
})

const scan = Effect.fn("PluginSupervisor.scan")(function* (entries: readonly Config.Entry[]) {
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  const discovered = yield* Effect.forEach(
    entries.filter((entry): entry is Config.Directory => entry.type === "directory"),
    (entry) => discoverDirectory(fs, entry.path),
  ).pipe(Effect.map((items) => items.flat()))
  const configured = yield* configuredOperations(entries, location.directory)
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

// Matches anything at or under <root>/{plugin,plugins}. No file-suffix check:
// directory-level events such as renames carry no per-file paths.
function isPluginSource(entries: readonly Config.Entry[], file: string) {
  return Config.isSourcePath(entries, file, sourceDirectories)
}

const externalPluginTargets = Effect.fn("PluginSupervisor.externalPluginTargets")(function* (
  entries: readonly Config.Entry[],
  location: string,
) {
  return Array.from(
    new Set(
      (yield* configuredOperations(entries, location))
        .filter((operation): operation is Extract<Operation, { type: "add" }> => operation.type === "add")
        .map((operation) => operation.target)
        .filter((target) => path.isAbsolute(target) && !isPluginSource(entries, target)),
    ),
  ).toSorted()
})

/**
 * Emits one signal per plugin-relevant change. Structured config and SDK
 * updates pass through immediately; filesystem changes from auto-discovered
 * sources and directly watched configured files share a 100ms debounce.
 */
const changes = Effect.fn("PluginSupervisor.changes")(function* () {
  const bus = yield* Bus.Service
  const config = yield* Config.Service
  const location = yield* Location.Service
  const watcher = yield* Watcher.Service
  const fileUpdates = yield* PubSub.unbounded<void>()

  // Direct watchers for configured plugin files outside auto-discovery
  // directories; sources under config roots reuse config.changes() instead.
  const external = new Map<string, Fiber.Fiber<void>>()
  const reconcile = Effect.fn("PluginSupervisor.reconcileExternal")(function* () {
    const targets = new Set(yield* externalPluginTargets(yield* config.entries(), location.directory))
    // Drop removed targets and finished watcher fibers; failed targets retry below.
    for (const [file, fiber] of external) {
      if (targets.has(file) && fiber.pollUnsafe() === undefined) continue
      external.delete(file)
      yield* Fiber.interrupt(fiber)
    }
    for (const file of targets) {
      if (external.has(file)) continue
      const fiber = yield* watcher.subscribe({ path: file, type: "file" }).pipe(
        Stream.runForEach(() => PubSub.publish(fileUpdates, undefined)),
        Effect.catchCause((cause) => Effect.logWarning("failed to watch plugin", { target: file, cause })),
        Effect.forkScoped({ startImmediately: true }),
      )
      external.set(file, fiber)
    }
  })
  yield* reconcile()

  const sourceChanges = config.changes().pipe(
    Stream.filterEffect((update) => Effect.map(config.entries(), (entries) => isPluginSource(entries, update.path))),
  )
  // Reconcile direct watchers before the update enters the generation queue so
  // new targets are observable as soon as their generation publishes.
  const configUpdates = bus.subscribe(Event.Updated).pipe(Stream.tap(() => reconcile()))
  const fileChanges = Stream.merge(sourceChanges, Stream.fromPubSub(fileUpdates)).pipe(Stream.debounce("100 millis"))
  return Stream.merge(Stream.merge(configUpdates, bus.subscribe(SdkPlugins.Updated)), fileChanges)
})

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
    const lock = Semaphore.makeUnsafe(1)
    const ready = yield* Deferred.make<void>()
    let observed = 0
    let applied = -1

    const activate = Effect.fn("PluginSupervisor.activate")(function* (target: number) {
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (applied >= target) return
          // Resolve OpenCode's internal plugins with their privileged Location services.
          const internal = yield* PluginInternal.list()
          // Combine internal plugins with host-contributed SDK plugins in boot order.
          const pre = [...internal.pre.map((plugin) => ({ ...plugin, version: "internal" })), ...sdk.all()]
          const post = internal.post.map((plugin) => ({ ...plugin, version: "internal" }))
          const operations = yield* scan(yield* config.entries())
          // Apply config operations and load enabled package plugins into one ordered generation.
          const plugins = yield* resolve(pre, post, operations)
          // Replace the active generation in one scoped, batched activation.
          yield* registry.activate(plugins)
          applied = target
        }),
      )
    })
    const changeStream = yield* changes()
    const updates = yield* changeStream.pipe(Stream.toQueue({ capacity: 1, strategy: "sliding" }))
    const signals = yield* Stream.concat(
      Stream.succeed(0),
      Stream.fromQueue(updates).pipe(Stream.mapEffect(() => Effect.sync(() => ++observed))),
    ).pipe(Stream.broadcast({ capacity: 1, strategy: "sliding", replay: 1 }))
    const attempt = (target: number) =>
      activate(target).pipe(
        Effect.map(() => observed === target),
        Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }).pipe(Effect.as(false))),
      )

    yield* signals.pipe(
      Stream.runForEach((target) =>
        activate(target).pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* signals.pipe(
      Stream.debounce("100 millis"),
      Stream.mapEffect(attempt),
      Stream.filter((settled) => settled),
      Stream.take(1),
      Stream.runDrain,
      Effect.andThen(Deferred.succeed(ready, undefined)),
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
    Bus.node,
    FileMutation.node,
    FileSystem.node,
    Watcher.node,
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
    WebSearch.node,
    WellKnown.node,
  ],
})

export { layer }
