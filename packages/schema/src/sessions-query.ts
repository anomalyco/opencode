export * as SessionsQuery from "./sessions-query.js"

import { DateTime, Effect, Encoding, Result, Schema, SchemaGetter, Struct } from "effect"
import { Project } from "./project.js"
import { AbsolutePath, PositiveInt, RelativePath, statics } from "./schema.js"
import { Session } from "./session.js"
import { Workspace } from "./workspace.js"

/**
 * Shared session list query and cursor codec. Lives in schema so both the
 * protocol session group and the core plugin host paginate identically.
 */

export const DefaultLimit = 50

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

export const Fields = {
  workspace: Workspace.ID.pipe(Schema.optional),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.optional(Schema.String),
  parentID: ParentIDFilter.pipe(Schema.optional),
}

const DirectoryQuery = Schema.Struct({
  ...Fields,
  directory: AbsolutePath,
})

const ProjectQuery = Schema.Struct({
  ...Fields,
  project: Project.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const AllQuery = Schema.Struct(Fields)

const withAnchor = <Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({
    ...Struct.omit(fields, ["limit"]),
    anchor: Session.ListAnchor,
  }))

const CursorInput = Schema.Union([withAnchor(DirectoryQuery), withAnchor(ProjectQuery), withAnchor(AllQuery)])
const CursorJson = Schema.fromJsonString(CursorInput)
const encodeCursor = Schema.encodeSync(CursorJson)
const decodeCursor = Schema.decodeUnknownEffect(CursorJson)
const invalidCursor = "Invalid cursor" as const

type PageQuery = Omit<typeof Query.Type, "limit" | "cursor">

export const Cursor = Schema.String.pipe(
  Schema.brand("SessionsCursor"),
  statics((schema) => {
    const make = schema.make.bind(schema)
    const makeCursor = (input: typeof CursorInput.Type) => make(Encoding.encodeBase64Url(encodeCursor(input)))
    return {
      make: makeCursor,
      parse: (input: string) =>
        Effect.suspend(() => {
          const result = Encoding.decodeBase64UrlString(input)
          return Result.isFailure(result)
            ? Effect.fail(invalidCursor)
            : decodeCursor(result.success).pipe(Effect.mapError(() => invalidCursor))
        }),
      /**
       * previous/next cursors for one returned page, re-anchoring the
       * originating query at the page's first and last items.
       */
      page: (query: PageQuery, data: ReadonlyArray<Session.Info>) => {
        const first = data[0]
        const last = data.at(-1)
        return {
          previous: first
            ? makeCursor({
                ...query,
                anchor: {
                  id: first.id,
                  time: DateTime.toEpochMillis(first.time.updated),
                  direction: "previous",
                },
              })
            : undefined,
          next: last
            ? makeCursor({
                ...query,
                anchor: {
                  id: last.id,
                  time: DateTime.toEpochMillis(last.time.updated),
                  direction: "next",
                },
              })
            : undefined,
        }
      },
    }
  }),
)
export type Cursor = typeof Cursor.Type

export const Query = Schema.Struct({
  ...Fields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: Project.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  cursor: Cursor.annotate({
    description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
  }).pipe(Schema.optional),
}).annotate({ identifier: "SessionsQuery" })
export type Query = typeof Query.Type
