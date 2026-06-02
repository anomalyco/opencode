export * as LocationFileSystem from "./location-filesystem"

import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer, Schema } from "effect"
import { Location } from "./location"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export class Content extends Schema.Class<Content>("LocationFileSystem.Content")({
  type: Schema.Literals(["text", "binary"]),
  content: Schema.String,
  encoding: Schema.Literal("base64").pipe(Schema.optional),
  mime: Schema.String.pipe(Schema.optional),
}) {}

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
    const location = yield* Location.Service
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
      read: Effect.fn("LocationFileSystem.read")(function* () {
        return new Content({ type: "text", content: "# opencode\n", mime: "text/markdown" })
      }),
      list: Effect.fn("LocationFileSystem.list")(function* () {
        return entries
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
