export * as PluginSupervisor from "./supervisor"

import type { Plugin } from "@opencode-ai/plugin/v2/effect/plugin"
import { Event } from "@opencode-ai/schema/config"
import { Context, Deferred, Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { ConfigPlugin } from "../config/plugin"
import { makeLocationNode } from "../effect/app-node"
import { httpClient } from "../effect/app-node-platform"
import { EventV2 } from "../event"
import { FileMutation } from "../file-mutation"
import { FileSystem } from "../filesystem"
import { Form } from "../form"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Image } from "../image"
import { Integration } from "../integration"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PermissionV2 } from "../permission"
import { PluginV2 } from "../plugin"
import { PluginPromise } from "../plugin/promise"
import { Reference } from "../reference"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { Shell } from "../shell"
import { SkillV2 } from "../skill"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { ToolRegistry } from "../tool/registry"
import { WebSearchTool } from "../tool/websearch"
import { PluginInternal } from "./internal"
import { PluginRuntime } from "./runtime"
import { SdkPlugins } from "./sdk"

const PluginModule = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      effect: Schema.declare<Plugin["effect"]>((input): input is Plugin["effect"] => typeof input === "function"),
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
  pre: readonly PluginV2.Versioned[],
  post: readonly PluginV2.Versioned[],
  operations: readonly Operation[],
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  const enabled = new Set(definitions.map((plugin) => plugin.id))
  const packages = new Map<string, PluginV2.Versioned>()
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

    const plugin = yield* load(operation).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
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
      : `${operation.target.replaceAll("\\", "/")}?mtime=${operation.mtime}`
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: source })
  const mod = yield* Effect.promise(() => import(source))
  const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    version: JSON.stringify(operation),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies PluginV2.Versioned
})

function discoverDirectory(fs: FSUtil.Interface, directory: string) {
  return Effect.gen(function* () {
    const files = yield* fs
      .glob("{plugin,plugins}/*.{ts,js}", {
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

export interface Interface {
  /** Wait for the initial plugin generation and startup updates to settle. */
  readonly flush: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* PluginV2.Service
    const sdk = yield* SdkPlugins.Service
    const config = yield* Config.Service
    const events = yield* EventV2.Service
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
    const updates = yield* events
      .subscribe([Event.Updated, SdkPlugins.Updated])
      .pipe(Stream.toQueue({ capacity: 1, strategy: "sliding" }))
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
    PluginV2.node,
    SdkPlugins.node,
    AgentV2.node,
    Catalog.node,
    CommandV2.node,
    Config.node,
    EventV2.node,
    FileMutation.node,
    FileSystem.node,
    FSUtil.node,
    Global.node,
    httpClient,
    Image.node,
    Integration.node,
    Location.node,
    LocationMutation.node,
    ModelsDev.node,
    Npm.node,
    PermissionV2.node,
    PluginRuntime.node,
    Form.node,
    ReadToolFileSystem.node,
    Reference.node,
    Ripgrep.node,
    SessionInstructions.node,
    Shell.node,
    SkillV2.node,
    ToolRegistry.toolsNode,
    WebSearchTool.configNode,
  ],
})

export { layer }
