export * as SessionList from "./session-list.js"

import { Effect, Encoding, Result, Schema, SchemaGetter, Struct } from "effect"
import { Project } from "./project.js"
import { Session } from "./session.js"
import { AbsolutePath, PositiveInt, RelativePath, statics } from "./schema.js"

const ParentIDFilter = Schema.Union([
  Session.ID,
  Schema.Null.pipe(
    Schema.encodeTo(Schema.Literal("null"), {
      decode: SchemaGetter.transform(() => null),
      encode: SchemaGetter.transform(() => "null" as const),
    }),
  ),
]).annotate({
  description: "Filter by parent session. Use null to return only root sessions.",
})

const QueryFields = {
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.optional(Schema.String),
  parentID: ParentIDFilter.pipe(Schema.optional),
}

const DirectoryQuery = Schema.Struct({ ...QueryFields, directory: AbsolutePath })
const ProjectQuery = Schema.Struct({ ...QueryFields, project: Project.ID, subpath: RelativePath.pipe(Schema.optional) })
const AllQuery = Schema.Struct(QueryFields)

const withCursor = <Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({ ...Struct.omit(fields, ["limit"]), anchor: Session.ListAnchor }))

const CursorInput = Schema.Union([withCursor(DirectoryQuery), withCursor(ProjectQuery), withCursor(AllQuery)])
const CursorJson = Schema.fromJsonString(CursorInput)
const encodeCursor = Schema.encodeSync(CursorJson)
const decodeCursor = Schema.decodeUnknownEffect(CursorJson)
const invalidCursor = "Invalid cursor" as const

export const Cursor = Schema.String.pipe(
  Schema.brand("SessionsCursor"),
  statics((schema) => {
    const make = schema.make.bind(schema)
    return {
      make: (input: typeof CursorInput.Type) => make(Encoding.encodeBase64Url(encodeCursor(input))),
      parse: (input: string) =>
        Effect.suspend(() => {
          const result = Encoding.decodeBase64UrlString(input)
          return Result.isFailure(result)
            ? Effect.fail(invalidCursor)
            : decodeCursor(result.success).pipe(Effect.mapError(() => invalidCursor))
        }),
    }
  }),
)
export type Cursor = typeof Cursor.Type

export const Query = Schema.Struct({
  ...QueryFields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: Project.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  cursor: Cursor.annotate({
    description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
  }).pipe(Schema.optional),
}).annotate({ identifier: "SessionsQuery" })
