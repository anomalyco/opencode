export * as FileSystem from "./filesystem"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location"
import { PositiveInt, RelativePath } from "./schema"
import { FileSystemSearch } from "./filesystem/search"
import { Entry, FileSystem, FindInput, Match } from "@opencode-ai/schema/filesystem"
import { WorkspaceEnvironment } from "./workspace/environment"
import { Ripgrep } from "./ripgrep"
export { Entry, Match, Submatch } from "@opencode-ai/schema/filesystem"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export const Content = Schema.Struct({
  uri: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  encoding: Schema.Literals(["utf8", "base64"]),
  mime: Schema.String,
}).annotate({ identifier: "FileSystem.Content" })
export type Content = typeof Content.Type

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export { FindInput }

export const DEFAULT_SEARCH_LIMIT = 100
/** One second of headroom over the hosted provider-side ripgrep kill. */
export const DEFAULT_SEARCH_TIMEOUT_MS = (Ripgrep.HOSTED_KILL_TIMEOUT_SECONDS + 1) * 1_000

/** Applies the shared search budget, failing with a search-scoped message. */
export const searchTimeout =
  <F>(fail: (message: string) => F) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | F, R> =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration: DEFAULT_SEARCH_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            fail(
              `Search timed out after ${DEFAULT_SEARCH_TIMEOUT_MS / 1_000} seconds. Consider using a more specific path or pattern.`,
            ),
          ),
      }),
    )

export class GlobInput extends Schema.Class<GlobInput>("FileSystem.GlobInput")({
  pattern: Schema.String,
  path: Schema.optionalKey(RelativePath),
  limit: Schema.optionalKey(PositiveInt),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("FileSystem.GrepInput")({
  pattern: Schema.String,
  path: Schema.optionalKey(RelativePath),
  include: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(PositiveInt),
}) {}

export interface SearchTarget {
  readonly canonical: string
  readonly absolute: string
}

export interface GlobSearchInput {
  readonly target: SearchTarget
  readonly pattern: string
  readonly limit: number
}

export interface GrepSearchInput {
  readonly target: SearchTarget
  readonly pattern: string
  readonly include?: string
  readonly limit: number
}

export class SearchPathError extends Schema.TaggedErrorClass<SearchPathError>()("FileSystem.SearchPathError", {
  path: Schema.String,
  reason: Schema.Literals(["not_found", "not_directory"]),
}) {}

export class SearchError extends Schema.TaggedErrorClass<SearchError>()("FileSystem.SearchError", {
  cause: Schema.Defect(),
}) {}

export class InvalidPatternError extends Schema.TaggedErrorClass<InvalidPatternError>()(
  "FileSystem.InvalidPatternError",
  {
    pattern: Schema.String,
    message: Schema.String,
  },
) {}

const mapSearchError = (error: unknown) =>
  error instanceof SearchPathError || error instanceof SearchError ? error : new SearchError({ cause: error })

const mapGrepError = (error: unknown) =>
  error instanceof Ripgrep.InvalidPatternError
    ? new InvalidPatternError({ pattern: error.pattern, message: error.message })
    : mapSearchError(error)

export const Event = FileSystem.Event

/** Directories first, then lexicographic; shared by every entry listing. */
export const compareEntries = (a: Entry, b: Entry) =>
  a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly glob: (input: GlobSearchInput) => Effect.Effect<Entry[], SearchPathError | SearchError>
  readonly grep: (input: GrepSearchInput) => Effect.Effect<Match[], SearchPathError | SearchError | InvalidPatternError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem") {}

const makeSearch = (
  location: Location.Interface,
  ripgrep: Ripgrep.Interface,
  paths: Pick<typeof path.posix, "resolve" | "relative" | "dirname" | "basename">,
  stat: (target: SearchTarget) => Effect.Effect<{ readonly type: string }, SearchPathError | SearchError>,
) => ({
  glob: Effect.fn("FileSystem.glob")(function* (input: GlobSearchInput) {
    if ((yield* stat(input.target)).type !== "Directory")
      return yield* new SearchPathError({ path: input.target.absolute, reason: "not_directory" })
    return yield* ripgrep
      .glob({
        cwd: input.target.canonical,
        pattern: input.pattern,
        limit: input.limit,
      })
      .pipe(
        Effect.map((entries) =>
          entries.map((entry) =>
            Entry.make({
              ...entry,
              path: RelativePath.make(
                paths.relative(location.directory, paths.resolve(input.target.absolute, entry.path)),
              ),
            }),
          ),
        ),
      )
  }, Effect.mapError(mapSearchError)),
  grep: Effect.fn("FileSystem.grep")(function* (input: GrepSearchInput) {
    const info = yield* stat(input.target)
    const file = info.type === "File"
    const cwd = file ? paths.dirname(input.target.absolute) : input.target.canonical
    const root = file ? paths.dirname(input.target.absolute) : input.target.absolute
    return yield* ripgrep
      .grep({
        cwd,
        pattern: input.pattern,
        file: file ? paths.basename(input.target.absolute) : undefined,
        include: input.include,
        limit: input.limit,
      })
      .pipe(
        Effect.map((matches) =>
          matches.map((match) =>
            Match.make({
              ...match,
              entry: Entry.make({
                ...match.entry,
                path: RelativePath.make(paths.relative(location.directory, paths.resolve(root, match.entry.path))),
              }),
            }),
          ),
        ),
      )
  }, Effect.mapError(mapGrepError)),
})

/**
 * Entry primitives the shared read/list implementations consume. Escape
 * failures and type mismatches are defects, matching route behavior.
 */
interface EntryBackend {
  readonly paths: Pick<typeof path.posix, "resolve" | "relative" | "join" | "sep">
  readonly contains: (parent: string, child: string) => boolean
  readonly realPath: (target: string) => Effect.Effect<string>
  /** Reads one file; non-file targets die. */
  readonly readFile: (real: string) => Effect.Effect<Uint8Array>
  /** Lists one directory; non-directory targets die. */
  readonly listDir: (real: string) => Effect.Effect<readonly FSUtil.DirEntry[]>
}

const makeEntries = (location: Location.Interface, root: string, backend: EntryBackend) => {
  const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
    const absolute = backend.paths.resolve(location.directory, input ?? ".")
    if (!backend.contains(location.directory, absolute))
      return yield* Effect.die(new Error("Path escapes the location"))
    const real = yield* backend.realPath(absolute)
    if (!backend.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
    return { absolute, real }
  })
  return {
    read: Effect.fn("FileSystem.read")(function* (input: ReadInput) {
      const target = yield* resolve(input.path)
      return {
        content: yield* backend.readFile(target.real),
        mime: FSUtil.mimeType(target.real),
      }
    }),
    list: Effect.fn("FileSystem.list")(function* (input: ListInput = {}) {
      const target = yield* resolve(input.path)
      const items = yield* backend.listDir(target.real)
      return items
        .flatMap((item) => {
          if (item.type !== "file" && item.type !== "directory") return []
          const absolute = backend.paths.join(target.absolute, item.name)
          const relative = backend.paths.relative(location.directory, absolute)
          return [
            Entry.make({
              path: RelativePath.make(relative + (item.type === "directory" ? backend.paths.sep : "")),
              type: item.type,
            }),
          ]
        })
        .sort(compareEntries)
    }),
  }
}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    const ripgrep = yield* Ripgrep.Service
    const searches = makeSearch(location, ripgrep, path, (target) =>
      fs.stat(target.canonical).pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.fail(new SearchPathError({ path: target.absolute, reason: "not_found" })),
        ),
        Effect.mapError(mapSearchError),
      ),
    )
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const entries = makeEntries(location, root, {
      paths: path,
      contains: FSUtil.contains,
      realPath: (target) => fs.realPath(target).pipe(Effect.orDie),
      readFile: (real) =>
        Effect.gen(function* () {
          const info = yield* fs.stat(real).pipe(Effect.orDie)
          if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
          return yield* fs.readFile(real).pipe(Effect.orDie)
        }),
      listDir: (real) =>
        Effect.gen(function* () {
          const info = yield* fs.stat(real).pipe(Effect.orDie)
          if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
          return yield* fs.readDirectoryEntries(real).pipe(Effect.orDie)
        }),
    })
    return Service.of({ find: search.find, ...searches, ...entries })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: baseLayer,
  deps: [FSUtil.node, Location.node, FileSystemSearch.node, Ripgrep.node],
})

// Mirrors baseLayer over WorkspaceEnvironment.Files with posix path rules.
// Host filesystem services never see provider paths. Type mismatches surface
// from the environment operation itself; no stat pre-checks.
const hostedLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const env = yield* WorkspaceEnvironment.Service
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const searches = makeSearch(location, ripgrep, path.posix, (target) =>
      env.files.stat(target.canonical).pipe(
        Effect.catchTag("WorkspaceEnvironment.NotFoundError", () =>
          Effect.fail(new SearchPathError({ path: target.absolute, reason: "not_found" })),
        ),
        Effect.mapError(mapSearchError),
      ),
    )
    const root = yield* env.files.realPath(location.directory).pipe(Effect.orDie)
    const entries = makeEntries(location, root, {
      paths: path.posix,
      contains: FSUtil.containsPosix,
      realPath: (target) => env.files.realPath(target).pipe(Effect.orDie),
      readFile: (real) => env.files.read(real).pipe(Effect.orDie),
      listDir: (real) => env.files.list(real).pipe(Effect.orDie),
    })
    return Service.of({
      find: () => Effect.logWarning("find is not supported for hosted locations yet").pipe(Effect.as([])),
      ...searches,
      ...entries,
    })
  }),
)

export const hostedNode = makeLocationNode({
  service: Service,
  layer: hostedLayer,
  deps: [WorkspaceEnvironment.node, Location.node, Ripgrep.node],
})
