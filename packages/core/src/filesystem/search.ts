export * as FileSystemSearch from "./search.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { Clock, Context, Deferred, Duration, Effect, Layer, Scope } from "effect"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "@opencode/schema/filesystem"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { RelativePath } from "../schema.js"
import { Protected } from "./protected.js"

export interface Result {
  readonly entries: FileSystem.Entry[]
  readonly indexTruncated: boolean
}

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
  readonly findWithStatus: (input: FileSystem.FindInput) => Effect.Effect<Result>
}

export interface Options {
  readonly fff?: boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem/Search") {}

const REFRESH_INTERVAL = Duration.toMillis("10 seconds")
type Prepared = ReturnType<typeof fuzzysort.prepare>

function emptyIndex() {
  return { files: new Map<string, Prepared>(), directories: new Map<string, Prepared>(), truncated: false }
}

function search(index: ReturnType<typeof emptyIndex>, input: FileSystem.FindInput) {
  const items =
    input.type === "file"
      ? Array.from(index.files.values())
      : input.type === "directory"
        ? Array.from(index.directories.values())
        : [...index.files.values(), ...index.directories.values()]
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

const ripgrepLayer = Layer.effect(
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
    let refreshing: Deferred.Deferred<void> | undefined
    const scan = Effect.gen(function* () {
      const next = emptyIndex()
      const previous = index
      if (!initialized) index = next
      const limited = !location.vcs || home
      // Keep source trees searchable before generated files exhaust the bounded index.
      for (const priority of limited ? [true, false] : [false]) {
        if (next.truncated) break
        yield* ripgrep.find({
          cwd: location.directory,
          pattern: "*",
          // Explicit paths preserve rg ignore rules, unlike a positive source glob.
          paths: priority ? ["./src"] : undefined,
          limit: limited ? 100_000 - next.files.size : Number.MAX_SAFE_INTEGER,
          // A capped parallel walk selects a different subset on each refresh.
          sort: limited,
          exclude: [
            ...(home ? [...Protected.names()].map((name) => `${name}/**`) : []),
            ...(limited && !priority ? ["src/**"] : []),
          ],
          onTruncated: () =>
            Effect.sync(() => {
              next.truncated = true
            }),
          onEntry: (entry) =>
            Effect.sync(() => {
              next.files.set(entry.path, previous.files.get(entry.path) ?? fuzzysort.prepare(entry.path))
              const parts = entry.path.split("/")
              parts.slice(0, -1).forEach((_, offset) => {
                const directory = parts.slice(0, offset + 1).join("/") + path.sep
                if (!next.directories.has(directory))
                  next.directories.set(directory, previous.directories.get(directory) ?? fuzzysort.prepare(directory))
              })
            }),
        })
      }
      index = next
      initialized = true
    }).pipe(Effect.orDie)
    const refresh = Effect.suspend(() => {
      if (refreshing) return initialized ? Effect.void : Deferred.await(refreshing)
      if (initialized && clock.currentTimeMillisUnsafe() < settledAt + REFRESH_INTERVAL) return Effect.void

      const attempt = Deferred.makeUnsafe<void>()
      refreshing = attempt
      return scan.pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            settledAt = clock.currentTimeMillisUnsafe()
            if (refreshing === attempt) refreshing = undefined
            Deferred.doneUnsafe(attempt, exit)
          }),
        ),
        Effect.forkIn(scope),
        Effect.flatMap(() => (initialized ? Effect.void : Deferred.await(attempt))),
      )
    })
    const findWithStatus = (input: FileSystem.FindInput) =>
      Effect.gen(function* () {
        yield* refresh
        return { entries: search(index, input), indexTruncated: index.truncated }
      })
    return Service.of({
      find: (input) => findWithStatus(input).pipe(Effect.map((result) => result.entries)),
      findWithStatus,
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
        findWithStatus: () => Effect.succeed({ entries: [], indexTruncated: false }),
      })
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => result.value.destroy()))
    const find = (input: FileSystem.FindInput) =>
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
      })
    return Service.of({
      find,
      findWithStatus: (input) => find(input).pipe(Effect.map((entries) => ({ entries, indexTruncated: false }))),
    })
  }),
)

const layer = (options?: Options) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const location = yield* Location.Service
      // Workspace-backed Locations resolve in a remote sandbox; fff would index the local server directory
      // in-process and serve wrong results. Ripgrep routes through the Location environment spawner.
      if (location.workspaceID) return ripgrepLayer
      if (options?.fff === false || (options?.fff === undefined && process.platform === "win32") || !Fff.available())
        return ripgrepLayer
      // Non-VCS locations can contain many repositories, so avoid eagerly content-indexing the entire aggregate tree.
      return location.vcs && !Protected.isHome(location.directory) ? fffLayer : ripgrepLayer
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({ service: Service, layer: layer(options), deps: [Location.node, Ripgrep.node] })
}

export const node = configured()
