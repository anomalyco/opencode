export * as FileSystem from "./filesystem.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Option, type PlatformError, Schema, Stream } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Environment } from "./environment/index.js"
import { Location } from "./location.js"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { Entry, FileSystem, FindInput, Write } from "@opencode/schema/filesystem"
export { Entry, Match, Submatch } from "@opencode/schema/filesystem"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export const WriteInput = Schema.Struct({
  /** Absolute, or relative to the location directory. */
  path: Schema.String,
  data: Schema.Uint8Array,
})
export type WriteInput = typeof WriteInput.Type

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

export const ListInput = Schema.Struct({
  path: Schema.String.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export { FindInput, Write }

export const DEFAULT_SEARCH_LIMIT = 100
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

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
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  /** Writes a file at an absolute path or one relative to the location; not confined to it. */
  readonly write: (input: WriteInput) => Effect.Effect<Write>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    // Workspace-placed directories exist only inside the workspace, so a host
    // realpath probe at boot consults the wrong filesystem and would block
    // construction on servers without a matching local directory. Treat the
    // configured directory as canonical; local placements keep symlink
    // canonicalization.
    const root = location.workspaceID
      ? location.directory
      : yield* fs.realPath(location.directory).pipe(
          Effect.catch((cause): Effect.Effect<never, DirectoryNotFoundError | DirectoryAccessDeniedError> => {
            if (cause.reason._tag === "NotFound")
              return Effect.fail(new DirectoryNotFoundError({ directory: location.directory, cause }))
            // macOS privacy denials arrive as Unknown with an EPERM cause.
            if (
              cause.reason._tag === "PermissionDenied" ||
              (cause.reason._tag === "Unknown" &&
                cause.reason.cause instanceof Error &&
                "code" in cause.reason.cause &&
                cause.reason.cause.code === "EPERM")
            )
              return Effect.fail(new DirectoryAccessDeniedError({ directory: location.directory, cause }))
            return Effect.die(cause)
          }),
        )
    const resolve = Effect.fnUntraced(function* (input: RelativePath) {
      if (input.includes("\u0000")) return yield* Effect.fail(new NotFoundError({ path: input }))
      const absolute = path.resolve(location.directory, input)
      if (!FSUtil.contains(location.directory, absolute)) return yield* Effect.fail(new NotFoundError({ path: input }))
      const real = yield* fs.realPath(absolute).pipe(
        Effect.catchReason(
          "PlatformError",
          "NotFound",
          () => Effect.fail(new NotFoundError({ path: input })),
          (_, error) => Effect.die(error),
        ),
      )
      if (!FSUtil.contains(root, real)) return yield* Effect.fail(new NotFoundError({ path: input }))
      return { absolute, real, directory: location.directory }
    })
    return Service.of({
      find: search.find,
      read: Effect.fn("FileSystem.read")(function* (input) {
        if (input.path.includes("\u0000")) return yield* Effect.fail(new NotFoundError({ path: input.path }))
        if (location.workspaceID) {
          const absolute = path.resolve(location.directory, input.path)
          if (!FSUtil.contains(location.directory, absolute)) {
            return yield* Effect.fail(new NotFoundError({ path: input.path }))
          }
          const canonicalRoot = yield* environment.files.realPath(location.directory).pipe(
            Effect.catchTag("Environment.NotFound", () => Effect.fail(new NotFoundError({ path: input.path }))),
            Effect.catchTag("Environment.Failed", (cause) => Effect.die(cause)),
          )
          const real = yield* environment.files.realPath(absolute).pipe(
            Effect.catchTag("Environment.NotFound", () => Effect.fail(new NotFoundError({ path: input.path }))),
            Effect.catchTag("Environment.Failed", (cause) => Effect.die(cause)),
          )
          if (!FSUtil.contains(canonicalRoot, real)) {
            return yield* Effect.fail(new NotFoundError({ path: input.path }))
          }
          const result = yield* environment.files.read(real, { offset: 0, length: 0 }).pipe(
            Effect.catchTag("Environment.NotFound", () => Effect.fail(new NotFoundError({ path: input.path }))),
            Effect.catchTag("Environment.WrongKind", () => Effect.fail(new NotFoundError({ path: input.path }))),
            Effect.catchTag("Environment.Failed", (cause) => Effect.die(cause)),
          )
          if (result.info.type !== "file") return yield* Effect.fail(new NotFoundError({ path: input.path }))
          return {
            mime: FSUtil.mimeType(real),
            size: result.info.size,
            mtime: Option.some(new Date(result.info.mtimeMs)),
            stream: (options) => {
              const offset = options?.offset ?? 0
              const end = Math.min(result.info.size, offset + (options?.bytesToRead ?? result.info.size))
              // Range reads keep the workspace backend's whole-file collection limit out of the streaming path.
              return Stream.unfold(offset, (position) => {
                if (position >= end) return Effect.succeed(undefined)
                return environment.files
                  .read(real, { offset: position, length: Math.min(64 * 1024, end - position) })
                  .pipe(
                    Effect.orDie,
                    Effect.map((chunk) =>
                      chunk.bytes.length === 0 ? undefined : ([chunk.bytes, position + chunk.bytes.length] as const),
                    ),
                  )
              })
            },
          }
        }
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(
          Effect.catchReason(
            "PlatformError",
            "NotFound",
            () => Effect.fail(new NotFoundError({ path: input.path })),
            (_, error) => Effect.die(error),
          ),
        )
        if (info.type !== "File") return yield* Effect.fail(new NotFoundError({ path: input.path }))
        return {
          mime: FSUtil.mimeType(target.real),
          size: Number(info.size),
          mtime: info.mtime,
          stream: (options) => fs.stream(target.real, options),
        }
      }),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        // Navigation can leave the cwd without activating another Location.
        const directory = path.resolve(location.directory, input.path ?? ".")
        if (location.workspaceID) {
          const items = yield* environment.files.list(directory).pipe(
            Effect.catchTag("Environment.WrongKind", () => Effect.die(new Error("Path is not a directory"))),
            Effect.orDie,
          )
          return items
            .flatMap((item) => {
              if (item.type !== "file" && item.type !== "directory") return []
              const absolute = path.join(directory, item.name)
              const relative = path.relative(location.directory, absolute) || "."
              return [
                Entry.make({
                  path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                  type: item.type,
                }),
              ]
            })
            .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1))
        }
        const info = yield* fs.stat(directory).pipe(Effect.orDie)
        if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
        return yield* fs.readDirectoryEntries(directory).pipe(
          Effect.orDie,
          Effect.map((items) =>
            items
              .flatMap((item) => {
                if (item.type !== "file" && item.type !== "directory") return []
                const absolute = path.join(directory, item.name)
                const relative = path.relative(location.directory, absolute) || "."
                return [
                  Entry.make({
                    path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                    type: item.type,
                  }),
                ]
              })
              .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
          ),
        )
      }),
      // Unlike read, write reaches outside the location so clients can stage files in the
      // server tmp directory, which the model is already told to prefer and permitted to access.
      write: Effect.fn("FileSystem.write")(function* (input) {
        const target = path.resolve(location.directory, input.path)
        yield* fs.writeWithDirs(target, input.data).pipe(Effect.orDie)
        return Write.make({ path: AbsolutePath.make(target) })
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: baseLayer,
  deps: [FSUtil.node, Location.node, FileSystemSearch.node, Environment.node],
})
