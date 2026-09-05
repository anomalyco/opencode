export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { Host } from "@opencode-ai/plugin/host"
import { createPluginSources } from "@opencode-ai/plugin/source"
import { Npm } from "@opencode-ai/util/npm"
import { Deferred, Effect, FiberSet, PubSub, Schema, Stream } from "effect"
import path from "path"
import { stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Generation } from "../plugin.js"
import { PluginPromise } from "./promise.js"
import { Watcher } from "../filesystem/watcher.js"

export const make = Effect.fn("PluginModule.make")(function* () {
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
    ) => load(operation, sources, options),
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
  if (!local && options?.install === false && !entrypoint) return { pending: true as const }
  if (!entrypoint) return yield* new LoadError({ message: `Plugin entrypoint not found: ${operation.target}` })
  yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint })
  const loaded = yield* Effect.promise(() =>
    local
      ? sources.read(entrypoint)
      : Host.load(entrypoint).then((module) => ({ module, version: installed?.revision })),
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
  const plugin = "effect" in value ? value : PluginPromise.fromPromise(value)
  return {
    id: plugin.id,
    features: {
      ...(entrypoints.tui ? { tui: true as const } : {}),
      ...(entrypoints.rpc ? { rpc: true as const } : {}),
    },
    revision: JSON.stringify([operation, loaded.version]),
    source: path.isAbsolute(operation.target)
      ? { type: "local" as const, path: fileURLToPath(entrypoint) }
      : {
          type: "package" as const,
          target: operation.target,
          ...(installed?.version ? { version: installed.version } : {}),
        },
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
  } satisfies Generation
})
