export * as ConfigPluginSource from "./source.js"

import type { Entry } from "@opencode-ai/schema/config"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, PubSub, Scope, Stream } from "effect"
import path from "path"
import { Config } from "../../config.js"
import { Watcher } from "../../filesystem/watcher.js"
import { Location } from "../../location.js"
import { PluginDiscovery } from "../../plugin/discovery.js"
import { PluginSourceDirectory } from "../../plugin/source-directory.js"

export type Operation = PluginDiscovery.Operation

export interface Interface {
  readonly operations: () => Effect.Effect<readonly Operation[], never, Scope.Scope>
  readonly changes: () => Stream.Stream<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigPluginSource") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const watcher = yield* Watcher.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const discovery = yield* PluginDiscovery.Service
    const configuredChanges = yield* PubSub.unbounded<void>()
    const watched = new Set<string>()

    // Configured local plugin files can live outside config roots, where the
    // config change feed cannot see them; watch those entrypoints directly.
    // Watches start on first sighting and are never torn down individually:
    // a stale watch after a config edit costs one deduped fs handle and a
    // no-op activation, and every watch dies with this layer's scope.
    const watchConfiguredSources = Effect.fn("ConfigPluginSource.watchConfiguredSources")(function* (
      entries: readonly Entry[],
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

    return Service.of({
      operations: Effect.fn("ConfigPluginSource.operations")(function* () {
        const entries = yield* config.entries()
        const operations = yield* discovery.operations(location.directory, entries)
        yield* watchConfiguredSources(entries, operations)
        return operations
      }),
      changes: () =>
        Stream.merge(
          config.changes().pipe(
            Stream.filterEffect((update) =>
              Effect.map(config.entries(), (entries) => isPluginSource(entries, update.path)),
            ),
            Stream.map(() => undefined),
          ),
          Stream.fromPubSub(configuredChanges),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Watcher.node, Location.node, PluginDiscovery.node],
})

export const empty = makeLocationNode({
  service: Service,
  layer: Layer.succeed(
    Service,
    Service.of({
      operations: () => Effect.succeed([]),
      changes: () => Stream.never,
    }),
  ),
  deps: [],
})

function isPluginSource(entries: readonly Entry[], file: string) {
  return entries.some(
    (entry) =>
      entry.type === "directory" &&
      PluginSourceDirectory.names.some((directory) => FSUtil.contains(path.join(entry.path, directory), file)),
  )
}
