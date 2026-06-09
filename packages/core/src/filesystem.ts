export * as FileSystem from "./filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { EventV2 } from "./event"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"
import { Search } from "./filesystem/search"

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

export const FindInput = Schema.Struct({
  query: Schema.String,
  type: Schema.Literals(["file", "directory"]).pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type FindInput = typeof FindInput.Type

export const GrepInput = Schema.Struct({
  pattern: Schema.String,
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type GrepInput = typeof GrepInput.Type

export class GrepMatch extends Schema.Class<GrepMatch>("LocationFileSystem.GrepMatch")({
  path: RelativePath,
  lines: Schema.String,
  line: PositiveInt,
  offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
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
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<GrepMatch[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FileSystem") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* Search.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real, directory: location.directory, root }
    })
    const entry = Effect.fnUntraced(function* (absolute: string, selected = { directory: location.directory, root }) {
      const real = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.void))
      if (!real) return
      if (!FSUtil.contains(selected.root, real)) return
      const info = yield* fs.stat(real).pipe(Effect.catch(() => Effect.void))
      const type = info?.type === "Directory" ? "directory" : info?.type === "File" ? "file" : undefined
      if (!type) return
      return new Entry({
        path: RelativePath.make(path.relative(selected.directory, absolute)),
        uri: pathToFileURL(real).href,
        type,
        mime: type === "directory" ? "application/x-directory" : FSUtil.mimeType(real),
      })
    })

    return Service.of({
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
          Effect.flatMap((items) =>
            Effect.forEach(items, (item) => entry(path.join(target.absolute, item.name), target), {
              concurrency: "unbounded",
            }),
          ),
          Effect.map((items) =>
            items
              .filter((item): item is Entry => item !== undefined)
              .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1)),
          ),
        )
      }),
      find: Effect.fn("FileSystem.find")(function* (input) {
        const found = yield* search
          .file({
            cwd: location.directory,
            query: input.query,
            limit: input.limit,
            kind: input.type ?? "all",
          })
          .pipe(Effect.orDie)
        return found.map(
          (item) =>
            new Entry({
              path: RelativePath.make(item.path),
              uri: pathToFileURL(path.join(location.directory, item.path)).href,
              type: item.type,
              mime: item.type === "directory" ? "application/x-directory" : FSUtil.mimeType(item.path),
            }),
        )
      }),
      grep: Effect.fn("FileSystem.grep")(function* (input) {
        return (yield* search
          .search({
            cwd: location.directory,
            pattern: input.pattern,
            glob: input.include ? [input.include] : undefined,
            limit: input.limit,
          })
          .pipe(Effect.orDie)).items.map(
          (item) =>
            new GrepMatch({
              path: RelativePath.make(item.path.text),
              lines: item.lines.text,
              line: item.line_number,
              offset: item.absolute_offset,
              submatches: item.submatches.map((submatch) => ({
                text: submatch.match.text,
                start: submatch.start,
                end: submatch.end,
              })),
            }),
        )
      }),
    })
  }),
)

export const locationLayer = layer
