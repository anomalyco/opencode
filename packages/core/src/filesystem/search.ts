export * as FileSystemSearch from "./search.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Scope,
  Semaphore,
  Stream,
} from "effect"
import { ChildProcess } from "effect/process"
import { Fff } from "#fff"
import fuzzysort from "fuzzysort"
import { FileSystem } from "@opencode/schema/filesystem"
import { Environment } from "../environment/index.js"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { RelativePath } from "../schema.js"
import { gitExecutable } from "../util/git-executable.js"
import { Protected } from "./protected.js"

export interface Interface {
  readonly find: (input: FileSystem.FindInput) => Effect.Effect<FileSystem.Entry[]>
}

export interface Options {
  readonly fff?: boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem/Search") {}

const REFRESH_INTERVAL = Duration.toMillis("10 seconds")
type Prepared = ReturnType<typeof fuzzysort.prepare>

function emptyIndex() {
  return { files: new Map<string, Prepared>(), directories: new Map<string, Prepared>() }
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

const DIRECTORY_CONCURRENCY = 8
const DIRECTORY_DEADLINE = Duration.seconds(3)

type DirectoryState = "empty" | "content" | "unknown"
type DirectoryVisit = { readonly state: DirectoryState; readonly added: readonly string[] }

// ripgrep only reports files, so directories without an indexed file are missing from the index.
// Walk the tree and stage only the directories that are provably empty: a failed listing makes a
// directory "unknown", and an unknown child makes its parent unknown too. Known directories (already
// indexed as a file's parent) are always descended so empty children under them are still found,
// while a non-known directory that holds visible files is pruned so ignored subtrees stay out of the
// index. Additions are staged per subtree and returned to the caller, which publishes them after
// evaluating git ignore rules: a pruned or unknown subtree contributes nothing, and a walk cut off by
// the caller's deadline returns no discovered directories (the index keeps rg-derived parents only).
function walkDirectories(input: {
  readonly files: Environment.Files
  readonly directory: string
  readonly home: boolean
  readonly next: ReturnType<typeof emptyIndex>
}): Effect.Effect<readonly string[]> {
  const permits = Semaphore.makeUnsafe(DIRECTORY_CONCURRENCY)
  return Effect.gen(function* () {
    const protectedNames = input.home ? Protected.names() : undefined
    const visit: (absolute: string, relative: string, known: boolean) => Effect.Effect<DirectoryVisit> = (
      absolute,
      relative,
      known,
    ) =>
      Effect.gen(function* () {
        const entries = yield* permits
          .withPermit(input.files.list(absolute))
          .pipe(Effect.match({ onFailure: () => undefined, onSuccess: (entries) => entries }))
        // A known directory already holds an indexed file, so it is non-empty whether or not it lists.
        if (!entries) return { state: known ? ("content" as const) : ("unknown" as const), added: [] }
        const visible = entries.filter((entry) => entry.type === "file" && !entry.name.startsWith("."))
        const children = entries.filter(
          (entry) =>
            entry.type === "directory" &&
            !entry.name.startsWith(".") &&
            !(relative === "" && protectedNames?.has(entry.name)),
        )
        if (!known && visible.length > 0) return { state: "content" as const, added: [] }
        const results = yield* Effect.forEach(
          children,
          (entry) => {
            const child = relative === "" ? entry.name : `${relative}/${entry.name}`
            const childKnown = input.next.directories.has(`${child}${path.sep}`)
            return visit(path.join(absolute, entry.name), child, childKnown).pipe(
              Effect.map((result) => ({ key: `${child}${path.sep}`, known: childKnown, ...result })),
            )
          },
          { concurrency: DIRECTORY_CONCURRENCY },
        )
        const added = results.flatMap((result) => {
          if (result.state === "empty") return [result.key, ...result.added]
          return result.known ? result.added : []
        })
        if (known) return { state: "content" as const, added }
        return results.every((result) => result.state === "empty")
          ? { state: "empty" as const, added }
          : { state: "content" as const, added: [] }
      })
    const discovered = yield* visit(input.directory, "", true)
    return discovered.added
  })
}

// ripgrep has no directory-aware ignore query, so ask git's matcher about the staged candidates.
// Ignored directories can look structurally empty (only symlinks, hidden entries, or empty scope
// folders), so publishing them without evaluating ignore rules leaks node_modules-style trees.
function filterIgnoredDirectories(input: {
  readonly environment: Environment.Interface
  readonly location: Location.Interface
  readonly directories: readonly string[]
}): Effect.Effect<readonly string[]> {
  return Effect.gen(function* () {
    if (input.directories.length === 0) return []
    const paths = new Map(input.directories.map((key) => [key.replaceAll(path.sep, "/"), key]))
    const payload = [...paths.keys()].join("\0") + "\0"
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* input.environment.spawner.spawn(
          ChildProcess.make(
            input.location.workspaceID ? "git" : gitExecutable(),
            ["check-ignore", "--no-index", "--stdin", "-z"],
            {
              cwd: input.location.directory,
              extendEnv: true,
              stdin: Stream.make(new TextEncoder().encode(payload)),
              stderr: "ignore",
            },
          ),
        )
        const stdout = yield* Stream.decodeText(handle.stdout).pipe(Stream.mkString)
        const exitCode = yield* handle.exitCode
        return { stdout, exitCode }
      }),
    ).pipe(Effect.exit)
    // Exit code 1 means "nothing ignored". Anything else (spawn failure, defect, or another exit
    // code) cannot prove the candidates are unignored, so fail closed and keep only the file index.
    const usable = Exit.isSuccess(result) && (result.value.exitCode === 0 || result.value.exitCode === 1)
    if (!usable) {
      if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.interrupt
      yield* Effect.logWarning("directory search could not evaluate ignore rules")
      return []
    }
    const ignored = new Set(result.value.stdout.split("\0").filter(Boolean))
    return [...paths].flatMap(([posix, key]) => (ignored.has(posix) ? [] : [key]))
  })
}

const ripgrepLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const environment = yield* Environment.Service
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
      yield* ripgrep.find({
        cwd: location.directory,
        pattern: "*",
        limit: location.vcs && !home ? Number.MAX_SAFE_INTEGER : 100_000,
        exclude: home ? [...Protected.names()].map((name) => `${name}/**`) : undefined,
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
      const discovered = yield* walkDirectories({
        files: environment.files,
        directory: location.directory,
        home,
        next,
      }).pipe(Effect.timeoutOption(DIRECTORY_DEADLINE))
      const candidates = Option.getOrElse(discovered, () => [])
      // Only git-backed locations have ignore rules to evaluate for directory candidates; ripgrep's
      // own .ignore/.rgignore rules are not consulted outside a repository.
      const directories =
        location.vcs?.type === "git"
          ? yield* filterIgnoredDirectories({ environment, location, directories: candidates })
          : candidates
      directories.forEach((key) => {
        next.directories.set(key, previous.directories.get(key) ?? fuzzysort.prepare(key))
      })
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
    return Service.of({
      find: (input) =>
        Effect.gen(function* () {
          yield* refresh
          return search(index, input)
        }),
    })
  }),
)

const FFF_SCAN_WAIT = Duration.seconds(3)

type CreatePicker = (options: Fff.Init) => Fff.Result<Fff.Picker>

function createPicker(
  create: CreatePicker,
  directory: string,
): { ok: true; value: Fff.Picker } | { ok: false; error: unknown } {
  try {
    return create({
      basePath: directory,
      aiMode: true,
      disableMmapCache: true,
      disableContentIndexing: true,
    })
  } catch (error) {
    return { ok: false, error }
  }
}

// Each fff picker owns its own scanner, watcher and git threads, so it starts on the first search
// instead of when the Location boots.
export const makeFffLayer = (create: CreatePicker) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      let state: { readonly result: ReturnType<typeof createPicker>; scanned: boolean } | "closed" | undefined
      // The layer owns the picker before it exists: creating and publishing it is one synchronous,
      // uninterruptible step, so an interrupted search can't leave a native picker without this finalizer.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (typeof state === "object" && state.result.ok) state.result.value.destroy()
          state = "closed"
        }),
      )
      const acquire = Effect.uninterruptible(
        Effect.sync(() => {
          if (state !== undefined) return { current: state, created: false }
          state = { result: createPicker(create, location.directory), scanned: false }
          return { current: state, created: true }
        }),
      )
      const picker = Effect.gen(function* () {
        const { current, created } = yield* acquire
        if (current === "closed") return undefined
        if (!current.result.ok) {
          if (created) yield* Effect.logWarning("failed to initialize fff", { error: current.result.error })
          return undefined
        }
        if (!current.scanned) {
          const value = current.result.value
          yield* Effect.gen(function* () {
            while (value.isScanning()) yield* Effect.sleep("20 millis")
          }).pipe(Effect.timeoutOption(FFF_SCAN_WAIT))
          current.scanned = true
        }
        return current.result.value
      })
      return Service.of({
        find: (input) =>
          Effect.gen(function* () {
            const finder = yield* picker
            if (!finder) return []
            const options = { pageIndex: 0, pageSize: input.limit ?? 50 }
            const items = (() => {
              if (input.type === "file") {
                const found = finder.fileSearch(input.query.trim(), options)
                if (!found.ok) throw found.error
                return found.value.items.map((item, index) => ({
                  path: item.relativePath,
                  type: "file" as const,
                  score: found.value.scores[index]?.total ?? 0,
                }))
              }
              if (input.type === "directory") {
                const found = finder.directorySearch(input.query.trim(), options)
                if (!found.ok) throw found.error
                return found.value.items.map((item, index) => ({
                  path: item.relativePath,
                  type: "directory" as const,
                  score: found.value.scores[index]?.total ?? 0,
                }))
              }
              const found = finder.mixedSearch(input.query.trim(), options)
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

export const fffLayer = makeFffLayer(Fff.create)

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
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Location.node, Ripgrep.node, Environment.node],
  })
}

export const node = configured()
