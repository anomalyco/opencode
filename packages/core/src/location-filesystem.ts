export * as LocationFileSystem from "./location-filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Schema } from "effect"
import { AppFileSystem } from "./filesystem"
import { Location } from "./location"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export class TextContent extends Schema.Class<TextContent>("LocationFileSystem.TextContent")({
  type: Schema.Literal("text"),
  content: Schema.String,
  mime: Schema.String,
}) {}

export class BinaryContent extends Schema.Class<BinaryContent>("LocationFileSystem.BinaryContent")({
  type: Schema.Literal("binary"),
  content: Schema.String,
  encoding: Schema.Literal("base64"),
  mime: Schema.String,
}) {}

export const Content = Schema.Union([TextContent, BinaryContent]).pipe(Schema.toTaggedUnion("type"))
export type Content = typeof Content.Type

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export class Entry extends Schema.Class<Entry>("LocationFileSystem.Entry")({
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

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<Content>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<GrepMatch[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LocationFileSystem") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const location = yield* Location.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      if (input && path.isAbsolute(input)) return yield* Effect.die(new Error("Path must be relative to the location"))
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!AppFileSystem.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!AppFileSystem.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real }
    })
    const entry = Effect.fnUntraced(function* (absolute: string) {
      const real = yield* fs.realPath(absolute).pipe(Effect.catch(() => Effect.void))
      if (!real) return
      if (!AppFileSystem.contains(root, real)) return
      const info = yield* fs.stat(real).pipe(Effect.catch(() => Effect.void))
      if (!info) return
      const type = info.type === "Directory" ? "directory" : info.type === "File" ? "file" : undefined
      if (!type) return
      return new Entry({
        path: RelativePath.make(path.relative(location.directory, absolute)),
        uri: pathToFileURL(real).href,
        type,
        mime: type === "directory" ? "application/x-directory" : AppFileSystem.mimeType(real),
      })
    })
    const entries = [
      new Entry({
        path: RelativePath.make("README.md"),
        uri: pathToFileURL(path.join(location.directory, "README.md")).href,
        type: "file",
        mime: "text/markdown",
      }),
      new Entry({
        path: RelativePath.make("src"),
        uri: pathToFileURL(path.join(location.directory, "src")).href,
        type: "directory",
        mime: "application/x-directory",
      }),
    ]

    return Service.of({
      read: Effect.fn("LocationFileSystem.read")(function* (input) {
        const file = yield* resolve(input.path)
        const info = yield* fs.stat(file.real).pipe(Effect.orDie)
        if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
        const bytes = yield* fs.readFile(file.real).pipe(Effect.orDie)
        const mime = AppFileSystem.mimeType(file.real)
        if (!bytes.includes(0)) {
          const content = yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).pipe(
            Effect.option,
          )
          if (content._tag === "Some") return new TextContent({ type: "text", content: content.value, mime })
        }
        return new BinaryContent({
          type: "binary",
          content: Buffer.from(bytes).toString("base64"),
          encoding: "base64",
          mime,
        })
      }),
      list: Effect.fn("LocationFileSystem.list")(function* (input = {}) {
        const directory = yield* resolve(input.path)
        const info = yield* fs.stat(directory.real).pipe(Effect.orDie)
        if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
        return yield* fs.readDirectoryEntries(directory.real).pipe(
          Effect.orDie,
          Effect.flatMap((items) =>
            Effect.forEach(items, (item) => entry(path.join(directory.absolute, item.name)), {
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
      find: Effect.fn("LocationFileSystem.find")(function* (input) {
        return entries.filter((entry) => input.type === undefined || entry.type === input.type).slice(0, input.limit)
      }),
      grep: Effect.fn("LocationFileSystem.grep")(function* (input) {
        return [
          new GrepMatch({
            path: RelativePath.make("README.md"),
            lines: "# opencode",
            line: 1,
            offset: 0,
            submatches: [{ text: input.pattern, start: 0, end: input.pattern.length }],
          }),
        ].slice(0, input.limit)
      }),
    })
  }),
)
