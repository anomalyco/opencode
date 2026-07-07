export * as PluginSupervisor from "./supervisor"

import type { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Event } from "@opencode-ai/schema/config"
import { Context, Effect, Fiber, Layer, Option, Schema, Semaphore, Stream } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Config } from "../config"
import { ConfigPlugin } from "../config/plugin"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { PluginPromise } from "../plugin/promise"
import { PluginInternal } from "./internal"
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
  readonly ready: Effect.Effect<void>
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
    const reload = Effect.fn("PluginSupervisor.reload")(() =>
      lock.withPermit(
        Effect.gen(function* () {
          // Resolve OpenCode's internal plugins with their privileged Location services.
          const internal = yield* PluginInternal.list()
          // Combine internal plugins with host-contributed SDK plugins in boot order.
          const pre = [...internal.pre, ...sdk.all()]
          // Read the current layered config before resolving plugin directives and packages.
          const entries = yield* config.entries()
          const operations = yield* scan(entries)
          // Apply config operations and load enabled package plugins into one ordered generation.
          const plugins = yield* resolve(pre, internal.post, operations)
          // Replace the active generation in one scoped, batched activation.
          yield* registry.activate(plugins)
        }),
      ),
    )
    yield* events.subscribe([Event.Updated, SdkPlugins.Updated]).pipe(
      Stream.runForEach(() =>
        reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    const fiber = yield* reload().pipe(
      Effect.withSpan("PluginSupervisor.boot"),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({ ready: Fiber.join(fiber) })
  }),
)

export { layer }
