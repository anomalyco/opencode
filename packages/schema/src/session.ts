export * as Session from "./session.js"

import { Effect, Result, Schema, SchemaGetter, SchemaParser } from "effect"
import { Base64Url } from "effect/encoding"
import { Agent } from "./agent.js"
import { Location } from "./location.js"
import { Model } from "./model.js"
import { Project } from "./project.js"
import { AbsolutePath, DateTimeUtcFromMillis, optional, RelativePath, statics } from "./schema.js"
import { SessionEvent } from "./session-event.js"
import { SessionID } from "./session-id.js"
import { SessionMetadata } from "./session-metadata.js"
import { Money } from "./money.js"
import { Permission } from "./permission.js"
import { TokenUsage } from "./token-usage.js"
import { Revert } from "./session-revert.js"
import { SessionFork } from "./session-fork.js"

export const ID = SessionID
export type ID = SessionID

export const Metadata = SessionMetadata
export type Metadata = SessionMetadata

export const Event = SessionEvent

export { Revert }
export const ForkBoundary = SessionFork.Boundary
export type ForkBoundary = SessionFork.Boundary

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  fork: Schema.Struct({
    sessionID: ID,
    boundary: ForkBoundary,
  }).pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Money.USD,
  tokens: TokenUsage.Info,
  /** Outcome of the last completed execution, recorded at `time.idle`. Absent until a run reaches a terminal transition. */
  outcome: Schema.Literals(["succeeded", "failed", "interrupted"]).pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    /** Start of the most recent execution. While it runs, `idle` still holds the previous execution's end. A turn resumed after a restart keeps its original start. */
    busy: DateTimeUtcFromMillis.pipe(optional),
    /** End of the most recent completed execution. */
    idle: DateTimeUtcFromMillis.pipe(optional),
    viewed: DateTimeUtcFromMillis.pipe(optional),
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String.pipe(optional),
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  metadata: Metadata.pipe(optional),
  /** Evaluated after the agent's rules; the last matching rule wins. */
  permissions: Permission.Ruleset.pipe(optional),
  revert: Revert.pipe(optional),
}).annotate({ identifier: "Session.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}

// These fields are also the session.list HTTP query parameters. Raw Schema.optional keeps that
// endpoint's OpenAPI parameters unchanged.
const ListFilterFields = {
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.String.pipe(Schema.optional),
  parentID: Schema.Union([
    ID,
    Schema.Null.pipe(
      Schema.encodeTo(Schema.Literal("null"), {
        decode: SchemaGetter.transform(() => null),
        encode: SchemaGetter.transform(() => "null" as const),
      }),
    ),
  ])
    .annotate({ description: "Filter by parent session. Use null to return only root sessions." })
    .pipe(Schema.optional),
  archived: Schema.Literals(["true", "false"])
    .pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value === "true"),
        encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
      }),
    )
    .annotate({
      description:
        "Filter by archive state. Use true to return only archived sessions or false to exclude them. Omit to include both.",
    })
    .pipe(Schema.optional),
}

export const ListFilter = Schema.Struct({
  ...ListFilterFields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: Project.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
}).annotate({ identifier: "Session.ListFilter" })
export interface ListFilter extends Schema.Schema.Type<typeof ListFilter> {}

const ListCursorInput = Schema.Union([
  Schema.Struct({ ...ListFilterFields, directory: AbsolutePath, anchor: ListAnchor }),
  Schema.Struct({
    ...ListFilterFields,
    project: Project.ID,
    subpath: RelativePath.pipe(Schema.optional),
    anchor: ListAnchor,
  }),
  Schema.Struct({ ...ListFilterFields, anchor: ListAnchor }),
])
const ListCursorJson = Schema.fromJsonString(ListCursorInput)
const encodeListCursor = Schema.encodeSync(ListCursorJson)
const decodeListCursor = Schema.decodeUnknownEffect(ListCursorJson)

export const ListCursor = Schema.String.pipe(
  Schema.brand("SessionsCursor"),
  Schema.annotate({
    identifier: "SessionsCursor",
    description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
  }),
  statics((schema) => {
    // Read the default constructor without caching it on the schema, so `make` can be replaced.
    const make = SchemaParser.make(schema)
    return {
      make: (input: typeof ListCursorInput.Type) => make(Base64Url.encode(encodeListCursor(input))),
      parse: (input: string) =>
        Effect.suspend(() => {
          const result = Base64Url.decodeString(input)
          return Result.isFailure(result)
            ? Effect.fail("Invalid cursor" as const)
            : decodeListCursor(result.success).pipe(Effect.mapError(() => "Invalid cursor" as const))
        }),
    }
  }),
)
export type ListCursor = typeof ListCursor.Type
