export * as FileSystemSearch from "./search.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Clock, Context, Duration, Effect, Layer, Schema, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "../filesystem.js"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { RelativePath } from "../schema.js"
import { Protected } from "./protected.js"

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
}

export const Options = Schema.Struct({
  fff: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem/Search") {}

const REFRESH_INTERVAL = Duration.toMillis("10 seconds")
type Prepared = ReturnType<typeof fuzzysort.prepare>

function emptyIndex() {
  return {
    files: new Map<string, Prepared>(),
    directories: new Map<string, Prepared>(),
    fileTargets: [] as Prepared[],
    directoryTargets: [] as Prepared[],
    combinedTargets: undefined as Prepared[] | undefined,
  }
}

function search(index: ReturnType<typeof emptyIndex>, input: FileSystem.FindInput) {
  const items =
    input.type === "file"
      ? index.fileTargets
      : input.type === "directory"
        ? index.directoryTargets
        : (index.combinedTargets ??= [...index.fileTargets, ...index.directoryTargets])
  const result = fuzzysort.go(input.query, items, { limit: input.limit ?? 50 })
  // Targets are owned by the current location index. The only global fuzzysort
  // state left is its query cache, which must not retain every query forever.
  fuzzysort.cleanup()
  return result.map((item) => {
    const relative = item.target
    const type = relative.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
    return FileSystem.Entry.make({
      path: RelativePath.make(relative),
      type,
    })
  })
}

export const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const scope = yield* Scope.Scope
    const clock = yield* Clock.Clock
    const home = Protected.isHome(location.directory)
    let index = emptyIndex()
    let initialized = false
    let settledAt = Number.NEGATIVE_INFINITY
    let refreshing = false
    const scan = Effect.gen(function* () {
      const next = emptyIndex()
      const previous = index
      if (!initialized) index = next
      yield* ripgrep.scan({
        cwd: location.directory,
        pattern: "*",
        limit: location.vcs && !home ? Number.MAX_SAFE_INTEGER : 100_000,
        exclude: home ? [...Protected.names()].map((name) => `${name}/**`) : undefined,
        onEntry: (entry) =>
          Effect.sync(() => {
            const file = previous.files.get(entry.path) ?? fuzzysort.prepare(entry.path)
            next.files.set(entry.path, file)
            next.fileTargets.push(file)
            next.combinedTargets = undefined
            const parts = entry.path.split("/")
            let prefix = ""
            for (const [offset, part] of parts.entries()) {
              if (offset === parts.length - 1) break
              prefix = prefix ? `${prefix}/${part}` : part
              const directory = prefix + path.sep
              if (next.directories.has(directory)) continue
              const prepared = previous.directories.get(directory) ?? fuzzysort.prepare(directory)
              next.directories.set(directory, prepared)
              next.directoryTargets.push(prepared)
            }
          }),
      })
      index = next
      initialized = true
    }).pipe(
      Effect.orDie,
      Effect.ensuring(
        Effect.sync(() => {
          settledAt = clock.currentTimeMillisUnsafe()
          refreshing = false
        }),
      ),
    )
    const refresh = Effect.sync(() => {
      if (refreshing || clock.currentTimeMillisUnsafe() < settledAt + REFRESH_INTERVAL) return
      refreshing = true
      return scan
    }).pipe(Effect.flatMap((effect) => (effect ? effect.pipe(Effect.forkIn(scope)) : Effect.void)))
    yield* refresh
    return Service.of({
      find: (input) =>
        Effect.gen(function* () {
          yield* refresh
          return search(index, input)
        }),
    })
  }),
)

export const fffLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const result = yield* Effect.try({
      try: () =>
        Fff.create({
          basePath: location.directory,
          aiMode: true,
          disableMmapCache: true,
          disableContentIndexing: true,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((error) => Effect.logWarning("failed to initialize fff", { error }).pipe(Effect.as(undefined))),
    )
    if (!result?.ok) {
      if (result) yield* Effect.logWarning("failed to initialize fff", { error: result.error })
      return Service.of({
        find: () => Effect.succeed([]),
      })
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => result.value.destroy()).pipe(Effect.ignore))
    return Service.of({
      find: (input) =>
        Effect.sync(() => {
          const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
          const items = (() => {
            if (input.type === "file") {
              const found = result.value.fileSearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "file" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            if (input.type === "directory") {
              const found = result.value.directorySearch(input.query.trim(), options)
              if (!found.ok) throw found.error
              return found.value.items.map((item, index) => ({
                path: item.relativePath,
                type: "directory" as const,
                score: found.value.scores[index]?.total ?? 0,
              }))
            }
            const found = result.value.mixedSearch(input.query.trim(), options)
            if (!found.ok) throw found.error
            return found.value.items.map((item, index) => ({
              path: item.item.relativePath,
              type: item.type,
              score: found.value.scores[index]?.total ?? 0,
            }))
          })()
          return items
            .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
            .map((item) => {
              const relative = item.path.replaceAll("\\", "/").replace(/\/$/, "")
              return FileSystem.Entry.make({
                path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                type: item.type,
              })
            })
        }),
    })
  }),
)

export const layer = (options?: Options) =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (options?.fff === false || (options?.fff === undefined && process.platform === "win32") || !Fff.available())
        return ripgrepLayer
      const location = yield* Location.Service
      // Non-VCS locations can contain many repositories, so avoid eagerly content-indexing the entire aggregate tree.
      return location.vcs && !Protected.isHome(location.directory) ? fffLayer : ripgrepLayer
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({ service: Service, layer: layer(options), deps: [Location.node, Ripgrep.node] })
}

export const node = configured()
