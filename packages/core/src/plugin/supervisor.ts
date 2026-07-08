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
import { SessionTodo } from "../session/todo"
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

const PluginPackage = Schema.Struct({
  exports: Schema.optional(Schema.Unknown),
  main: Schema.optional(Schema.String),
  module: Schema.optional(Schema.String),
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

type Candidate =
  | {
      readonly type: "definition"
      readonly definition: Plugin
    }
  | {
      readonly type: "package"
      readonly specifier: string
      readonly options: Record<string, unknown>
      readonly mtime?: number
    }

type ConfiguredPackage = {
  readonly operation: Extract<Operation, { type: "add" }>
  enabled: boolean
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
        const directory = entry.path ? path.dirname(entry.path) : location.directory
        const target = operation.target.startsWith("file://")
          ? fileURLToPath(operation.target)
          : operation.target.startsWith("./") || operation.target.startsWith("../")
            ? path.resolve(directory, operation.target)
            : operation.target
        return operation.type === "add" ? { ...operation, target } : { type: "remove" as const, target }
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
  pre: readonly Plugin[],
  post: readonly Plugin[],
  operations: readonly Operation[],
) {
  const plan = apply(pre, post, operations)
  return yield* load(plan)
})

function apply(pre: readonly Plugin[], post: readonly Plugin[], operations: readonly Operation[]) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const plugins = [...pre, ...post]
  const enabled = new Set(plugins.map((plugin) => plugin.id))
  const packages = new Map<string, ConfiguredPackage>()

  for (const operation of operations) {
    if (operation.type === "remove") {
      plugins.filter((plugin) => matches(operation.target, plugin.id)).forEach((plugin) => enabled.delete(plugin.id))
      packages.forEach((item, target) => {
        if (matches(operation.target, target)) item.enabled = false
      })
      continue
    }

    const matched = plugins.filter((plugin) => matches(operation.target, plugin.id))
    const selectsDefinitions =
      matched.length > 0 ||
      operation.target === "*" ||
      operation.target.endsWith(".*") ||
      operation.target.startsWith("opencode.")
    if (selectsDefinitions) {
      matched.forEach((plugin) => enabled.add(plugin.id))
      packages.forEach((item, target) => {
        if (matches(operation.target, target)) item.enabled = true
      })
      continue
    }

    packages.set(operation.target, { operation, enabled: true })
  }

  const definitions: Candidate[] = pre.flatMap((definition) =>
    enabled.has(definition.id) ? [{ type: "definition", definition }] : [],
  )
  const configured: Candidate[] = Array.from(packages.values()).flatMap((item) =>
    item.enabled
      ? [
          {
            type: "package",
            specifier: item.operation.target,
            options: item.operation.options,
            ...(item.operation.mtime === undefined ? {} : { mtime: item.operation.mtime }),
          },
        ]
      : [],
  )
  const posts: Candidate[] = post.flatMap((definition) =>
    enabled.has(definition.id) ? [{ type: "definition", definition }] : [],
  )
  return [...definitions, ...configured, ...posts]
}

const load = Effect.fn("PluginSupervisor.load")(function* (plan: readonly Candidate[]) {
  return yield* Effect.forEach(plan, (candidate) => {
    if (candidate.type === "definition") return Effect.succeed({ plugin: candidate.definition })
    return Effect.gen(function* () {
      const npm = yield* Npm.Service
      const entrypoint = path.isAbsolute(candidate.specifier)
        ? pathToFileURL(candidate.specifier).href
        : (yield* npm.add(candidate.specifier)).entrypoint
      if (!entrypoint) return
      // Bun currently ignores query parameters when caching file:// imports.
      const source =
        candidate.mtime === undefined
          ? entrypoint
          : `${candidate.specifier.replaceAll("\\", "/")}?mtime=${candidate.mtime}`
      yield* Effect.log({ msg: "loading plugin", id: candidate.specifier, entrypoint: source })
      const mod = yield* Effect.promise(() => import(source))
      const value = (yield* Schema.decodeUnknownEffect(PluginModule)(mod)).default
      const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
      return {
        plugin: {
          id: plugin.id,
          effect: (host) => plugin.effect({ ...host, options: candidate.options }),
        } satisfies Plugin,
        ...(candidate.mtime === undefined ? {} : { version: String(candidate.mtime) }),
      }
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
  }).pipe(Effect.map((plugins) => plugins.filter((plugin) => plugin !== undefined)))
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
    const directories = yield* fs
      .glob("{plugin,plugins}/*", {
        cwd: directory,
        absolute: true,
        include: "all",
        dot: true,
        symlink: true,
      })
      .pipe(
        Effect.flatMap((items) => Effect.filter(items, (item) => fs.isDir(item), { concurrency: "unbounded" })),
        Effect.orElseSucceed(() => []),
      )
    const packages = yield* Effect.forEach(directories.sort(), (directory) => resolvePackageEntrypoint(fs, directory), {
      concurrency: "unbounded",
    }).pipe(Effect.map((items) => items.filter((item): item is string => item !== undefined)))
    return [...files.sort(), ...packages].map((target): Operation => ({ type: "add", target, options: {} }))
  })
}

const resolvePackageEntrypoint = Effect.fnUntraced(function* (fs: FSUtil.Interface, directory: string) {
  const pkg = yield* fs.readJson(path.join(directory, "package.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PluginPackage)),
    Effect.catch(() => Effect.succeed(undefined)),
  )
  const exported = typeof pkg?.exports === "string" ? pkg.exports : undefined
  const entries = [exported, pkg?.module, pkg?.main, "index.ts", "index.js"]

  return yield* Effect.forEach(entries, (entry) => {
    if (!entry) return Effect.succeed(undefined)
    const file = path.resolve(directory, entry)
    return fs.isFile(file).pipe(Effect.map((exists) => (exists ? file : undefined)))
  }).pipe(Effect.map((items) => items.find((item): item is string => item !== undefined)))
})

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
          const pre = [...internal.pre, ...sdk.all()]
          const operations = yield* scan(yield* config.entries())
          // Apply config operations and load enabled package plugins into one ordered generation.
          const plugins = yield* resolve(pre, internal.post, operations)
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
    SessionTodo.node,
    Shell.node,
    SkillV2.node,
    ToolRegistry.toolsNode,
    WebSearchTool.configNode,
  ],
})

export { layer }
