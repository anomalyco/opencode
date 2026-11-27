export * as FileSystem from "./filesystem.js"

import { realpathSync } from "node:fs"
import path from "node:path"
import { Entry, FileSystem, FindInput, Write } from "@opencode/schema/filesystem"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Context, Effect, Layer, Option, PlatformError, Schema, Stream } from "effect"
import { Environment } from "./environment/index.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { Location } from "./location.js"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema.js"
export { Entry, Match, Submatch } from "@opencode/schema/filesystem"

export interface ReadInput {
  readonly path: RelativePath
}

export interface WriteInput {
  /** Absolute, or relative to the location directory. */
  readonly path: string
  readonly data: Uint8Array
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("FileSystem.NotFoundError", {
  path: RelativePath,
}) {}

export class DirectoryNotFoundError extends Schema.TaggedError<DirectoryNotFoundError>()(
  "FileSystem.DirectoryNotFoundError",
  {
    directory: AbsolutePath,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Directory not found: ${this.directory}`
  }
}

export class DirectoryAccessDeniedError extends Schema.TaggedError<DirectoryAccessDeniedError>()(
  "FileSystem.DirectoryAccessDeniedError",
  {
    directory: AbsolutePath,
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Access denied to directory: ${this.directory}`
  }
}

export const Content = Schema.Struct({
  uri: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  encoding: Schema.Literals(["utf8", "base64"]),
  mime: Schema.String,
}).annotate({ identifier: "FileSystem.Content" })
export type Content = typeof Content.Type

export interface ListInput {
  readonly path?: string
}

export { FindInput, Write }

export const DEFAULT_SEARCH_LIMIT = 100
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000
const REMOTE_CHUNK_BYTES = 4 * 1024 * 1024

export class GlobInput extends Schema.Class<GlobInput>("FileSystem.GlobInput")({
  pattern: Schema.String,
  path: Schema.optionalKey(RelativePath),
  hidden: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(PositiveInt),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("FileSystem.GrepInput")({
  pattern: Schema.String,
  path: Schema.optionalKey(RelativePath),
  include: Schema.optionalKey(Schema.String),
  literal: Schema.optionalKey(Schema.Boolean),
  caseSensitive: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(PositiveInt),
}) {}

export const Event = FileSystem.Event

export interface File {
  readonly mime: string
  readonly size: number
  readonly mtime: Option.Option<Date>
  readonly stream: (options?: {
    readonly offset?: number
    readonly bytesToRead?: number
  }) => Stream.Stream<Uint8Array, PlatformError.PlatformError>
}

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<File, NotFoundError>
  /** Fails with `NotFoundError` when the path is missing or is not a directory. */
  readonly list: (input?: ListInput) => Effect.Effect<Entry[], NotFoundError>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  /** Writes a file at an absolute path or one relative to the location; not confined to it. */
  readonly write: (input: WriteInput) => Effect.Effect<Write>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem") {}

const mapMissing = <A>(
  effect: Effect.Effect<A, Environment.NotFound | Environment.WrongKind | Environment.Failed>,
  target: RelativePath,
): Effect.Effect<A, NotFoundError> =>
  effect.pipe(
    Effect.catchTags({
      "Environment.NotFound": () => Effect.fail(new NotFoundError({ path: target })),
      "Environment.WrongKind": () => Effect.fail(new NotFoundError({ path: target })),
      "Environment.Failed": Effect.die,
    }),
  )

const toStreamError = (target: string, cause: Environment.NotFound | Environment.WrongKind | Environment.Failed) =>
  PlatformError.systemError({
    _tag:
      cause._tag === "Environment.NotFound"
        ? "NotFound"
        : cause._tag === "Environment.WrongKind"
          ? "BadResource"
          : "Unknown",
    module: "FileSystem",
    method: "stream",
    pathOrDescriptor: target,
    cause,
  })

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    const envPath = environment.path ?? path

    // Directories outside the server host do not live on the host filesystem,
    // so a host realpath probe at boot would consult the wrong filesystem and
    // block construction when no matching local directory exists. Host
    // placements keep boot realpath canonicalization and symlink containment;
    // remote reads enforce lexical containment while isolation lives at the
    // remote sandbox or worker boundary.
    const root = environment.local
      ? yield* fs.realPath(location.directory).pipe(
          // Windows' native realpath fails with ENOENT on drive letters without a volume mount point, such as
          // DriveCrypt drives, although the directory is readable; the JS realpath walks the path and resolves it.
          // A directory that is really missing fails both, so the NotFound below still applies.
          Effect.catchIf(
            (cause) => cause.reason._tag === "NotFound",
            (cause) => Effect.try({ try: () => realpathSync(location.directory), catch: () => cause }),
          ),
          // Linux realpath succeeds on an unreadable directory, so probe readability explicitly.
          Effect.tap((real) => fs.access(real, { readable: true })),
          Effect.catch((cause): Effect.Effect<never, DirectoryNotFoundError | DirectoryAccessDeniedError> => {
            if (cause.reason._tag === "NotFound")
              return Effect.fail(new DirectoryNotFoundError({ directory: location.directory, cause }))
            if (FSUtil.isAccessDenied(cause))
              return Effect.fail(new DirectoryAccessDeniedError({ directory: location.directory, cause }))
            return Effect.die(cause)
          }),
        )
      : location.directory

    const confine = Effect.fnUntraced(function* (input: RelativePath) {
      if (input.includes("\u0000")) return yield* new NotFoundError({ path: input })
      const absolute = envPath.resolve(location.directory, input)
      if (!FSUtil.contains(location.directory, absolute, envPath)) return yield* new NotFoundError({ path: input })
      return absolute
    })

    const readLocal = Effect.fnUntraced(function* (input: RelativePath) {
      const absolute = yield* confine(input)
      const real = yield* fs.realPath(absolute).pipe(
        Effect.catchReason(
          "PlatformError",
          "NotFound",
          () => Effect.fail(new NotFoundError({ path: input })),
          (_, error) => Effect.die(error),
        ),
      )
      if (!FSUtil.contains(root, real, envPath)) return yield* new NotFoundError({ path: input })
      const info = yield* fs.stat(real).pipe(
        Effect.catchReason(
          "PlatformError",
          "NotFound",
          () => Effect.fail(new NotFoundError({ path: input })),
          (_, error) => Effect.die(error),
        ),
      )
      if (info.type !== "File") return yield* new NotFoundError({ path: input })
      return {
        mime: FSUtil.mimeType(real),
        size: Number(info.size),
        mtime: info.mtime,
        stream: (options) => fs.stream(real, options),
      } satisfies File
    })

    const readRemote = Effect.fnUntraced(function* (input: RelativePath) {
      const absolute = yield* confine(input)
      // Zero-byte ranged read checks existence, file kind, size, and mtime without transferring file bytes
      // until the caller actually consumes stream().
      const probe = yield* mapMissing(environment.files.read(absolute, { offset: 0, length: 0 }), input)
      return {
        mime: FSUtil.mimeType(absolute),
        size: probe.info.size,
        mtime: probe.info.mtimeMs > 0 ? Option.some(new Date(probe.info.mtimeMs)) : Option.none(),
        // Paginate in fixed chunks so large files (>64 MiB exec cap) stream cleanly without buffering whole files in RAM.
        stream: (options) => {
          const start = Math.max(0, options?.offset ?? 0)
          const end = options?.bytesToRead === undefined ? Infinity : start + Math.max(0, options.bytesToRead)
          if (end <= start) return Stream.empty
          return Stream.paginate(start, (offset) => {
            const length = Math.min(REMOTE_CHUNK_BYTES, end - offset)
            return environment.files.read(absolute, { offset, length }).pipe(
              Effect.map((result) => {
                const next = offset + result.bytes.length
                const done = result.bytes.length < length || next >= end
                return [
                  result.bytes.length > 0 ? [result.bytes] : [],
                  done ? Option.none() : Option.some(next),
                ] as const
              }),
              Effect.mapError((cause) => toStreamError(absolute, cause)),
            )
          })
        },
      } satisfies File
    })

    const readFile = environment.local ? readLocal : readRemote

    return Service.of({
      find: search.find,
      read: Effect.fn("FileSystem.read")((input) => readFile(input.path)),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        // Navigation can leave the cwd without activating another Location.
        const directory = envPath.resolve(location.directory, input.path ?? ".")
        const items = yield* mapMissing(environment.files.list(directory), RelativePath.make(input.path ?? "."))
        return items
          .flatMap((item) => {
            if (item.type !== "file" && item.type !== "directory") return []
            const absolute = envPath.join(directory, item.name)
            const relative = envPath.relative(location.directory, absolute) || "."
            return [
              Entry.make({
                path: RelativePath.make(relative + (item.type === "directory" ? envPath.sep : "")),
                type: item.type,
              }),
            ]
          })
          .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1))
      }),
      // Unlike read, write is not confined to the location so clients can stage files in the
      // environment's temp directory (e.g. /tmp) for tools to reference.
      write: Effect.fn("FileSystem.write")(function* (input) {
        const target = envPath.resolve(location.directory, input.path)
        yield* environment.files.write(target, input.data).pipe(Effect.orDie)
        return Write.make({ path: AbsolutePath.make(target) })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: baseLayer,
  deps: [Environment.node, FSUtil.node, Location.node, FileSystemSearch.node],
})
