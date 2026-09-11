import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { RemoteAuthorization } from "../middleware/remote-authorization"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const remoteRoot = "/remote"

export const RemotePairToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: Schema.Number,
})

export const RemoteRedeemInput = Schema.Struct({ ticket: Schema.String })
export const RemoteRedeemResult = Schema.Struct({
  token: Schema.String,
  sessionID: SessionID,
  expires_in: Schema.Number,
})

const RemoteMessagePart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    tool: Schema.String,
    state: Schema.Struct({
      status: Schema.Literals(["pending", "running", "completed", "error"]),
    }),
  }),
])

const RemotePermission = Schema.Struct({
  id: PermissionV1.ID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
})

const RemoteQuestion = Schema.Struct({
  id: QuestionID,
  questions: Schema.Array(Question.Info),
})

export const RemoteBootstrap = Schema.Struct({
  session: Schema.Struct({ title: Schema.String }),
  messages: Schema.Array(
    Schema.Struct({
      info: Schema.Struct({ role: Schema.Literals(["user", "assistant"]) }),
      parts: Schema.Array(RemoteMessagePart),
    }),
  ),
  status: Schema.Struct({ type: Schema.Literals(["idle", "retry", "busy"]) }),
  permissions: Schema.Array(RemotePermission),
  questions: Schema.Array(RemoteQuestion),
})

export const RemoteMessagePayload = Schema.Struct({
  parts: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("text"),
      text: Schema.String,
    }),
  ),
})

export const RemotePermissionReply = Schema.Struct({
  reply: PermissionV1.Reply,
  message: Schema.optional(Schema.String),
})

export const RemoteQuestionReply = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})

export const RemoteAdminApi = HttpApi.make("remote-admin").add(
  HttpApiGroup.make("remote-admin")
    .add(
      HttpApiEndpoint.post("pair", "/session/:sessionID/remote", {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: RemotePairToken,
        error: [HttpApiError.BadRequest, ApiNotFoundError],
      }),
      HttpApiEndpoint.delete("revoke", "/session/:sessionID/remote", {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.Boolean,
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .annotateMerge(OpenApi.annotations({ title: "remote admin", description: "Manage session remote access." })),
)

export const RemotePairApi = HttpApi.make("remote-pair").add(
  HttpApiGroup.make("remote-pair").add(
    HttpApiEndpoint.post("redeem", `${remoteRoot}/pair`, {
      payload: RemoteRedeemInput,
      success: RemoteRedeemResult,
      error: HttpApiError.Forbidden,
    }),
  ),
)

export const RemoteApi = HttpApi.make("remote").add(
  HttpApiGroup.make("remote")
    .add(
      HttpApiEndpoint.get("bootstrap", `${remoteRoot}/session/:sessionID`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: RemoteBootstrap,
        error: [HttpApiError.Forbidden, ApiNotFoundError],
      }),
      HttpApiEndpoint.get("events", `${remoteRoot}/session/:sessionID/events`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
        error: HttpApiError.Forbidden,
      }),
      HttpApiEndpoint.post("message", `${remoteRoot}/session/:sessionID/message`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        payload: RemoteMessagePayload,
        success: HttpApiSchema.NoContent,
        error: [HttpApiError.BadRequest, HttpApiError.Forbidden, ApiNotFoundError],
      }),
      HttpApiEndpoint.post("abort", `${remoteRoot}/session/:sessionID/abort`, {
        params: { sessionID: SessionID },
        query: WorkspaceRoutingQuery,
        success: Schema.Boolean,
        error: HttpApiError.Forbidden,
      }),
      HttpApiEndpoint.post("permission", `${remoteRoot}/session/:sessionID/permission/:requestID`, {
        params: { sessionID: SessionID, requestID: PermissionV1.ID },
        query: WorkspaceRoutingQuery,
        payload: RemotePermissionReply,
        success: Schema.Boolean,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("question", `${remoteRoot}/session/:sessionID/question/:requestID`, {
        params: { sessionID: SessionID, requestID: QuestionID },
        query: WorkspaceRoutingQuery,
        payload: RemoteQuestionReply,
        success: Schema.Boolean,
        error: HttpApiError.BadRequest,
      }),
      HttpApiEndpoint.post("questionReject", `${remoteRoot}/session/:sessionID/question/:requestID/reject`, {
        params: { sessionID: SessionID, requestID: QuestionID },
        query: WorkspaceRoutingQuery,
        success: Schema.Boolean,
        error: HttpApiError.BadRequest,
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(RemoteAuthorization)
    .annotateMerge(OpenApi.annotations({ title: "remote", description: "Session-scoped mobile remote control." })),
)
