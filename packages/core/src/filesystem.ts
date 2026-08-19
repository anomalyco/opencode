export * as FileSystem from "./filesystem"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { PositiveInt, RelativePath } from "./schema"
import { FileSystemSearch } from "./filesystem/search"
import { Entry, FileSystem, FindInput, Match } from "@opencode-ai/schema/filesystem"
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

export class GlobInput extends Schema.Class<GlobInput>("FileSystem.GlobInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("FileSystem.GrepInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export const Event = FileSystem.Event

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[]>
  readonly write: (input: { path: string; content: Uint8Array }) => Effect.Effect<void>
  readonly writeStream: (input: { path: string; stream: Stream.Stream<Uint8Array, unknown> }) => Effect.Effect<void, Error>
  readonly remove: (input: { path: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real, directory: location.directory, root }
    })
    // Resolves a relative target and verifies it stays inside the location.
    // Walks up to the nearest existing ancestor so the realpath containment
    // check also covers targets whose parent directories do not exist yet
    // (e.g. uploading a file into a new subdirectory). Symlinks are resolved
    // through the realpath of that ancestor, so links pointing outside the
    // location are rejected.
    const resolveTarget = Effect.fnUntraced(function* (input: string) {
      const absolute = path.resolve(location.directory, input)
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      let ancestor = path.dirname(absolute)
      for (;;) {
        const info = yield* fs.stat(ancestor).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (info) break
        const parent = path.dirname(ancestor)
        if (parent === ancestor) return yield* Effect.die(new Error("Path escapes the location"))
        ancestor = parent
      }
      const real = yield* fs.realPath(ancestor).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, realParent: real }
    })
    return Service.of({
      find: search.find,
      glob: search.glob,
      grep: search.grep,
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
        const target = yield* resolveTarget(input.path)
        yield* fs.writeWithDirs(target.absolute, input.content).pipe(Effect.orDie)
      }),
      writeStream: Effect.fn("FileSystem.writeStream")(function* (input) {
        const target = yield* resolveTarget(input.path)
        // Upload streams can fail while being read (e.g. a multipart part that
        // exceeds the configured size limit), so surface the error instead of
        // dying so the caller can map it to a client error. fs-util.writeStream
        // streams into a temp file and renames it into place only on success,
        // so a failure never truncates or deletes an existing file at the
        // target path.
        yield* fs.writeStream(target.absolute, input.stream)
      }),
      remove: Effect.fn("FileSystem.remove")(function* (input) {
        const target = yield* resolveTarget(input.path)
        // Never allow deleting the location root itself (e.g. an empty or "." path).
        if (target.absolute === location.directory)
          return yield* Effect.die(new Error("Path resolves to the location root"))
        yield* fs.remove(target.absolute, { recursive: true, force: true }).pipe(Effect.orDie)
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
