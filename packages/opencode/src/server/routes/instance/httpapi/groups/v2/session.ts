import { WorkspaceID } from "@/control-plane/schema"
import { SessionID } from "@/session/schema"
import { SessionMessage } from "@/v2/session-message"
import { Prompt } from "@/v2/session-prompt"
import { SessionV2 } from "@/v2/session"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"

export const SessionGroup = HttpApiGroup.make("v2.session")
  .add(
    HttpApiEndpoint.get("sessions", "/api/session", {
      query: Schema.Union([
        Schema.Struct({
          limit: Schema.optional(
            Schema.NumberFromString.check(
              Schema.isInt(),
              Schema.isGreaterThanOrEqualTo(1),
              Schema.isLessThanOrEqualTo(200),
            ),
          ).annotate({
            description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
          }),
          order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
            description: "Session order for the first page. Use desc for newest first or asc for oldest first.",
          }),
          directory: Schema.String.pipe(Schema.optional),
          path: Schema.String.pipe(Schema.optional),
          workspace: WorkspaceID.pipe(Schema.optional),
          roots: Schema.Literals(["true", "false"])
            .pipe(
              Schema.decodeTo(Schema.Boolean, {
                decode: SchemaGetter.transform((value) => value === "true"),
                encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
              }),
            )
            .pipe(Schema.optional),
          start: Schema.NumberFromString.pipe(Schema.optional),
          search: Schema.String.pipe(Schema.optional),
          cursor: Schema.optional(Schema.Never),
        }),
        Schema.Struct({
          limit: Schema.optional(
            Schema.NumberFromString.check(
              Schema.isInt(),
              Schema.isGreaterThanOrEqualTo(1),
              Schema.isLessThanOrEqualTo(200),
            ),
          ).annotate({
            description: "Maximum number of sessions to return. Defaults to the newest 50 sessions.",
          }),
          cursor: Schema.String.annotate({
            description:
              "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order.",
          }),
          order: Schema.optional(Schema.Never),
          directory: Schema.optional(Schema.Never),
          path: Schema.optional(Schema.Never),
          workspace: Schema.optional(Schema.Never),
          roots: Schema.optional(Schema.Never),
          start: Schema.optional(Schema.Never),
          search: Schema.optional(Schema.Never),
        }),
      ]).annotate({ identifier: "V2SessionsQuery" }),
      success: Schema.Struct({
        items: Schema.Array(SessionV2.Info),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }).annotate({ identifier: "V2SessionsResponse" }),
      error: HttpApiError.BadRequest,
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
      payload: Schema.Struct({
        prompt: Prompt,
        delivery: SessionV2.Delivery.pipe(Schema.optional),
      }),
      success: SessionMessage.Message,
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
      success: HttpApiSchema.NoContent,
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
      success: HttpApiSchema.NoContent,
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
      success: Schema.Array(SessionMessage.Message),
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
  .middleware(Authorization)
