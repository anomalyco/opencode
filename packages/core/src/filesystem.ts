export * as FileSystem from "./filesystem.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "./location.js"
import { PositiveInt, RelativePath } from "./schema.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { FileMutation } from "./file-mutation.js"
import { Entry, FileSystem, FindInput, WriteConflictError, WriteInput } from "@opencode-ai/schema/filesystem"
export { Entry, Match, Submatch, WriteConflictError, WriteInput } from "@opencode-ai/schema/filesystem"

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
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

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

export const Event = FileSystem.Event

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly write: (input: WriteInput) => Effect.Effect<boolean, WriteConflictError>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    // Workspace-placed directories exist only inside the workspace, so a host
    // realpath probe at boot consults the wrong filesystem and would block
    // construction on servers without a matching local directory. Treat the
    // configured directory as canonical; local placements keep symlink
    // canonicalization. This skip is boot-only: resolve/read/list below still
    // access the host filesystem per operation (tracked in #44568).
    const root = location.workspaceID ? location.directory : yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real, directory: location.directory }
    })
    return Service.of({
      find: search.find,
      read: Effect.fn("FileSystem.read")(function* (input) {
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(Effect.orDie)
        if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
        return {
          content: yield* fs.readFile(target.real).pipe(Effect.orDie),
          mime: FSUtil.mimeType(target.real),
        }
      }),
      write: Effect.fn("FileSystem.write")(function* (input) {
        // Host filesystem operations do not yet address workspace placement (#44568).
        if (location.workspaceID) return yield* Effect.die(new Error("Writing workspace files is not supported"))
        const target = yield* resolve(input.path)
        return yield* Effect.gen(function* () {
          const info = yield* fs.stat(target.real).pipe(Effect.orDie)
          if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
          const current = yield* fs.readFile(target.real).pipe(Effect.orDie)
          if (
            current.length !== input.expected.length ||
            !current.every((byte, index) => byte === input.expected[index])
          )
            return yield* new WriteConflictError({ path: input.path, message: "File changed since it was read" })
          yield* fs.writeFile(target.real, input.content).pipe(Effect.orDie)
          return true
        }).pipe(Effect.uninterruptible, FileMutation.withLock([target.absolute, target.real]))
      }),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(Effect.orDie)
        if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
        return yield* fs.readDirectoryEntries(target.real).pipe(
          Effect.orDie,
          Effect.map((items) =>
            items
              .flatMap((item) => {
                if (item.type !== "file" && item.type !== "directory") return []
                const absolute = path.join(target.absolute, item.name)
                const relative = path.relative(target.directory, absolute)
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
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: baseLayer,
  deps: [FSUtil.node, Location.node, FileSystemSearch.node],
})
