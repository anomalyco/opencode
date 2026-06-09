export * as FileSystem from "./filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { Ripgrep } from "./ripgrep"
import { RelativePath } from "./schema"
import { FileSystemFind } from "./filesystem/find"

export { Input as FindInput } from "./filesystem/find"

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

export class Entry extends Schema.Class<Entry>("FileSystem.Entry")({
  path: RelativePath,
  uri: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  mime: Schema.String,
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
  readonly read: (input: ReadInput) => Effect.Effect<Content>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FileSystemFind.Input) => Effect.Effect<Entry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const find = yield* FileSystemFind.Service
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
      find: find.find,
      read: Effect.fn("FileSystem.read")(function* (input) {
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(Effect.orDie)
        if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
        const bytes = yield* fs.readFile(target.real).pipe(Effect.orDie)
        const mime = FSUtil.mimeType(target.real)
        if (!bytes.includes(0)) {
          const content = yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).pipe(
            Effect.option,
          )
          if (Option.isSome(content))
            return {
              uri: pathToFileURL(target.real).href,
              name: path.basename(target.real),
              content: content.value,
              encoding: "utf8" as const,
              mime,
            }
        }
        return {
          uri: pathToFileURL(target.real).href,
          name: path.basename(target.real),
          content: Buffer.from(bytes).toString("base64"),
          encoding: "base64" as const,
          mime,
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
                return [
                  new Entry({
                    path: RelativePath.make(path.relative(target.directory, absolute)),
                    uri: pathToFileURL(absolute).href,
                    type: item.type,
                    mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(absolute),
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

export const layer = baseLayer.pipe(Layer.provide(FileSystemFind.layer), Layer.provide(Ripgrep.defaultLayer))

export const locationLayer = layer
