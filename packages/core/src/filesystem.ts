export * as FileSystem from "./filesystem"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { PositiveInt, RelativePath } from "./schema"
import { FileSystemSearch } from "./filesystem/search"
import { Entry, Match } from "./filesystem/schema"
export { Entry, Match, Submatch } from "./filesystem/schema"

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

export class FindInput extends Schema.Class<FindInput>("FileSystem.FindInput")({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

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

export const Event = {
  Edited: EventV2.define({
    type: "file.edited",
    schema: {
      file: Schema.String,
    },
  }),
}

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[]>
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

export const layer = baseLayer.pipe(Layer.provide(FileSystemSearch.locationLayer), Layer.provide(FSUtil.defaultLayer))

export const locationLayer = layer
