import { SessionID } from "@/session/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionV2 } from "@opencode-ai/core/session"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath, PositiveInt, RelativePath, withStatics } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  InvalidCursorError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnknownError,
} from "../../errors"
import { V2Authorization } from "../../middleware/authorization"
import { WorkspaceRoutingQuery } from "../../middleware/workspace-routing"

const SessionsQueryFields = {
  workspace: WorkspaceV2.ID.pipe(Schema.optional),
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  search: Schema.optional(Schema.String),
}

const SessionsDirectoryQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath,
})

const SessionsProjectQuery = Schema.Struct({
  ...SessionsQueryFields,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const SessionsAllQuery = Schema.Struct(SessionsQueryFields)

const withCursor = <Fields extends Schema.Struct.Fields>(schema: Schema.Struct<Fields>) =>
  schema.mapFields((fields) => ({
    ...Struct.omit(fields, ["limit"]),
    anchor: SessionV2.ListAnchor,
  }))

const SessionsCursorInput = Schema.Union([
  withCursor(SessionsDirectoryQuery),
  withCursor(SessionsProjectQuery),
  withCursor(SessionsAllQuery),
])
const SessionsCursorJson = Schema.fromJsonString(SessionsCursorInput)
const encodeSessionsCursor = Schema.encodeSync(SessionsCursorJson)
const decodeSessionsCursor = Schema.decodeUnknownEffect(SessionsCursorJson)

export const SessionsCursor = Schema.String.pipe(
  Schema.brand("V2SessionsCursor"),
  withStatics((schema) => {
    const make = schema.make
    return {
      make: (input: typeof SessionsCursorInput.Type) =>
        make(Buffer.from(encodeSessionsCursor(input)).toString("base64url")),
      parse: (input: string) => decodeSessionsCursor(Buffer.from(input, "base64url").toString("utf8")),
    }
  }),
)
export type SessionsCursor = typeof SessionsCursor.Type

const SessionsCursorQuery = Schema.Struct({
  cursor: SessionsCursor.annotate({
    description: "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response.",
  }),
  limit: SessionsQueryFields.limit,
})

export const SessionsQuery = Schema.Struct({
  ...SessionsQueryFields,
  directory: AbsolutePath.pipe(Schema.optional),
  project: ProjectV2.ID.pipe(Schema.optional),
  subpath: RelativePath.pipe(Schema.optional),
  cursor: SessionsCursorQuery.fields.cursor.pipe(Schema.optional),
}).annotate({ identifier: "V2SessionsQuery" })

export const SessionGroup = HttpApiGroup.make("v2.session")
  .add(
    HttpApiEndpoint.get("sessions", "/api/session", {
      query: SessionsQuery,
      success: Schema.Struct({
        items: Schema.Array(SessionV2.Info),
        cursor: Schema.Struct({
          previous: SessionsCursor.pipe(Schema.optional),
          next: SessionsCursor.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "V2SessionsResponse" }),
      error: [InvalidCursorError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.list",
        summary: "List v2 sessions",
        description:
          "Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt", "/api/session/:sessionID/prompt", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({
        prompt: Prompt,
        delivery: SessionV2.Delivery.pipe(Schema.optional),
      }),
      success: SessionMessage.Message,
      error: [SessionNotFoundError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.prompt",
        summary: "Send v2 message",
        description: "Create a v2 session message and queue it for the agent loop.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("compact", "/api/session/:sessionID/compact", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.compact",
        summary: "Compact v2 session",
        description: "Compact a v2 session conversation.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("wait", "/api/session/:sessionID/wait", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: HttpApiSchema.NoContent,
      error: [SessionNotFoundError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.wait",
        summary: "Wait for v2 session",
        description: "Wait for a v2 session agent loop to become idle.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("context", "/api/session/:sessionID/context", {
      params: { sessionID: SessionID },
      query: WorkspaceRoutingQuery,
      success: Schema.Array(SessionMessage.Message),
      error: [SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.session.context",
        summary: "Get v2 session context",
        description: "Retrieve the active context messages for a v2 session (all messages after the last compaction).",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2",
      description: "Experimental v2 routes.",
    }),
  )
  .middleware(V2Authorization)
