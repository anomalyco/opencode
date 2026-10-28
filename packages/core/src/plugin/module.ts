export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Host } from "@opencode/plugin/host"
import { GuiBundle } from "@opencode/schema/plugin"
import { createPluginSources } from "@opencode/plugin/source"
import { Hash } from "@opencode/util/hash"
import { Npm } from "@opencode/util/npm"
import { Deferred, Effect, FiberSet, PubSub, Schema, Stream } from "effect"
import path from "path"
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Generation } from "../plugin.js"
import { PluginPromise } from "./promise.js"
import { Config } from "../config.js"
import { ManagedPolicy } from "../managed-policy.js"
import { Watcher } from "../filesystem/watcher.js"

export const make = Effect.fn("PluginModule.make")(function* () {
  const config = yield* Config.Service
  const managed = yield* ManagedPolicy.Service
  const watcher = yield* Watcher.Service
  const scope = yield* Effect.scope
  const runPromise = yield* FiberSet.makeRuntimePromise()
  const changes = yield* PubSub.unbounded<void>()
  const watched = new Set<string>()
  const watch = Effect.fn("PluginModule.watch")(function* (file: string) {
    if (watched.has(file)) return
    watched.add(file)
    const ready = yield* Deferred.make<void>()
    const target = yield* Effect.promise(() => watchTarget(file))
    const updates = yield* watcher.subscribe(target, Deferred.succeed(ready, undefined))
    yield* updates.pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.ensuring(Deferred.succeed(ready, undefined)),
      Effect.forkIn(scope, { startImmediately: true }),
    )
    yield* Deferred.await(ready)
  })
  const sources = yield* Effect.acquireRelease(
    Effect.sync(() => createPluginSources((file) => runPromise(watch(file)))),
    (sources) => Effect.sync(() => sources.dispose()),
  )
  return {
    load: (
      operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
      options?: { readonly install?: boolean },
    ) =>
      Effect.gen(function* () {
        const version = operation.target.lastIndexOf("@")
        const target =
          path.isAbsolute(operation.target) || version <= 0 ? operation.target : operation.target.slice(0, version)
        if (
          ManagedPolicy.decision(
            ManagedPolicy.statements(yield* config.entries(), managed.current()),
            "integration.use",
            `plugin:${target}`,
          ) === "deny"
        )
          return { blocked: true as const }
        return yield* load(operation, sources, watch, options)
      }),
    changes: () => Stream.fromPubSub(changes),
  }
})

// A missing dependency may have missing parents too. Watch the nearest existing
// ancestor recursively so creating the rest of the path can trigger recovery.
function watchTarget(file: string): Promise<Watcher.WatchInput> {
  return stat(file).then(
    (info) => ({ path: file, type: info.isDirectory() ? "directory" : "file" }),
    (cause) => {
      if (path.dirname(file) === file) throw cause
      return watchTarget(path.dirname(file))
    },
  )
}

const GuiOptions = GuiBundle.fields.options

const Module = Schema.Struct({
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

export class LoadError extends Schema.TaggedError<LoadError>()("PluginModule.LoadError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const load = Effect.fn("PluginModule.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
  sources: ReturnType<typeof createPluginSources>,
  watch: (file: string) => Effect.Effect<void>,
  options?: { readonly install?: boolean },
) {
  const local = path.isAbsolute(operation.target)
  const npm = yield* Npm.Service
  const installed = local
    ? undefined
    : options?.install === false
      ? yield* npm.resolve(operation.target)
      : yield* npm.add(operation.target)
  // Legacy auto-discovery still admits standalone server sources. Configured
  // local plugins always arrive here as directories.
  const entrypoints: Host.Entrypoints =
    local && (yield* Effect.promise(() => stat(operation.target))).isFile()
      ? { server: pathToFileURL(operation.target).href }
      : yield* Effect.sync(() => Host.resolve(installed ?? { directory: operation.target }))
  const entrypoint = entrypoints.server
  // A TUI-only package is not the server's to list; the TUI loads it from its own config.
  const found = entrypoint || entrypoints.gui
  if (!local && options?.install === false && !found) return { pending: true as const }
  if (!found) return yield* new LoadError({ message: `Plugin entrypoint not found: ${operation.target}` })
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: found })
  // A package with only a GUI part (and maybe a TUI part) has nothing to run here: its id is its package name, and its
  // other parts load from this listing.
  const server = entrypoint
    ? yield* loadServer(entrypoint, local ? sources : undefined, installed?.revision)
    : undefined
  const plugin = server?.plugin ?? {
    id: Host.packageID(installed ?? { directory: operation.target }),
    effect: () => Effect.void,
  }
  const revision = JSON.stringify([operation, server ? server.version : installed?.revision])
  // A local plugin's `./gui-experimental` bundle is outside the server entry's import graph: watch it, and let its
  // content change the GUI's revision, so an edit reloads the GUI like a server or TUI edit reloads theirs. A package's
  // bundle changes only with its installed version. The GUI's revision is a hash: windows receive it, and the operation
  // holds the options.
  const gui = local && entrypoints.gui ? fileURLToPath(entrypoints.gui) : undefined
  if (gui) yield* watch(gui)
  const bundle = gui ? Hash.sha256(yield* Effect.promise(() => readFile(gui))) : undefined
  // The GUI receives the same options as the server entry; they cross to the app, so they must be JSON.
  const guiOptions = entrypoints.gui
    ? yield* Schema.decodeUnknownEffect(GuiOptions)(operation.options).pipe(
        Effect.mapError(
          (cause) => new LoadError({ message: "Plugin options must be JSON to reach its ./gui-experimental", cause }),
        ),
      )
    : {}
  return {
    id: plugin.id,
    features: {
      ...(entrypoint ? { server: true as const } : {}),
      ...(entrypoints.tui ? { tui: true as const } : {}),
      ...(entrypoint && entrypoints.rpc ? { rpc: true as const } : {}),
      ...(entrypoints.gui ? { gui: true as const } : {}),
    },
    gui: entrypoints.gui
      ? { file: entrypoints.gui, revision: Hash.sha256(JSON.stringify([revision, bundle])), options: guiOptions }
      : undefined,
    revision,
    // A local plugin's directory (or legacy standalone file), where clients resolve its other parts.
    source: local
      ? { type: "local" as const, path: operation.target }
      : {
          type: "package" as const,
          target: operation.target,
          ...(installed?.version ? { version: installed.version } : {}),
        },
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Generation
})

const loadServer = Effect.fn("PluginModule.loadServer")(function* (
  entrypoint: string,
  sources: ReturnType<typeof createPluginSources> | undefined,
  revision: string | undefined,
) {
  const loaded = yield* Effect.promise(() =>
    sources ? sources.read(entrypoint) : Host.load(entrypoint).then((module) => ({ module, version: revision })),
  )
  const value = (yield* Schema.decodeUnknownEffect(Module)(loaded.module).pipe(
    Effect.mapError(
      (cause) =>
        new LoadError({
          message: "Plugin must export a default definition with an id and an effect or setup function.",
          cause,
        }),
    ),
  )).default
  return { plugin: "effect" in value ? value : PluginPromise.fromPromise(value), version: loaded.version }
})
