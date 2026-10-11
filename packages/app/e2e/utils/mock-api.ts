import { Predicate, Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"
import { Pty } from "@opencode/schema/pty"
import { Worktree } from "@opencode/schema/worktree"

// Handlers answer plain fixture data: undefined properties are dropped, and other non-JSON values become null.
const Json = Schema.Json.pipe(
  Schema.decodeTo(Schema.Unknown, {
    decode: SchemaGetter.passthrough(),
    encode: SchemaGetter.transform(function json(value): Schema.Json {
      if (value === null || Predicate.isString(value) || Predicate.isBoolean(value)) return value

      if (Predicate.isNumber(value)) return Number.isFinite(value) ? value : null

      if (Array.isArray(value)) return value.map(json)

      if (!Predicate.isObject(value)) return null

      return Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, json(item)]])),
      )
    }),
  }),
  HttpApiSchema.asJson(),
)

const JsonPayload = Schema.Unknown.pipe(HttpApiSchema.asJson())

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  parentID: Schema.optional(Schema.String),
  search: Schema.optional(Schema.String),
  order: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  path: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  before: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
})

const SessionParams = { sessionID: Schema.String }

const PtyParams = { ptyID: Pty.ID }

const NoContent = HttpApiSchema.NoContent

export class MockNotFound extends Schema.TaggedError<MockNotFound>()("MockNotFound", {
  message: Schema.String,
}) {}

export class MockBadRequest extends Schema.TaggedError<MockBadRequest>()("MockBadRequest", {
  message: Schema.String,
}) {}

export class MockInternal extends Schema.TaggedError<MockInternal>()("MockInternal", {
  message: Schema.String,
}) {}

// The server's error for an unknown shell command; the timeline shows that shell's output as missing.
export class MockShellNotFound extends Schema.TaggedError<MockShellNotFound>()("ShellNotFoundError", {
  id: Schema.String,
  message: Schema.String,
}) {}

// The server's error for an unknown PTY, or one owned by another workspace.
export class MockPtyNotFound extends Schema.TaggedError<MockPtyNotFound>()("PtyNotFoundError", {
  ptyID: Schema.String,
  message: Schema.String,
}) {}

// The server's error for a request without its password.
export class MockUnauthorized extends Schema.TaggedError<MockUnauthorized>()("UnauthorizedError", {
  message: Schema.String,
}) {}

// A mutation the scenario did not configure a handler for.
export class MockUnsupported extends Schema.TaggedError<MockUnsupported>()("MockUnsupported", {
  message: Schema.String,
}) {}

const Unsupported = MockUnsupported.pipe(HttpApiSchema.status(501))

const PtyMissing = [MockNotFound.pipe(HttpApiSchema.status(404)), MockPtyNotFound.pipe(HttpApiSchema.status(404))]

const Group = HttpApiGroup.make("mock")
  .add(HttpApiEndpoint.get("info", "/api/info", { success: Json }))
  .add(
    HttpApiEndpoint.get("event", "/api/event", {
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
    }),
  )
  .add(HttpApiEndpoint.get("reference", "/api/reference", { success: Json }))
  .add(HttpApiEndpoint.get("config", "/api/config", { success: Json }))
  .add(HttpApiEndpoint.get("agent", "/api/agent", { success: Json }))
  .add(HttpApiEndpoint.get("provider", "/api/provider", { success: Json }))
  .add(HttpApiEndpoint.get("model", "/api/model", { success: Json }))
  .add(HttpApiEndpoint.get("modelDefault", "/api/model/default", { success: Json }))
  .add(HttpApiEndpoint.get("integrationList", "/api/integration", { success: Json }))
  .add(
    HttpApiEndpoint.get("integrationGet", "/api/integration/:integrationID", {
      params: { integrationID: Schema.String },
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("integrationConnect", "/api/integration/:integrationID/connect/key", {
      params: { integrationID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("integrationOAuthConnect", "/api/integration/:integrationID/connect/oauth", {
      params: { integrationID: Schema.String },
      payload: JsonPayload,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.get("integrationOAuthStatus", "/api/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Schema.String, attemptID: Schema.String },
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("credentialRemove", "/api/credential/:credentialID", {
      params: { credentialID: Schema.String },
      success: NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("command", "/api/command", { success: Json }))
  .add(HttpApiEndpoint.get("skill", "/api/skill", { success: Json }))
  .add(HttpApiEndpoint.get("plugin", "/api/plugin", { success: Json }))
  .add(HttpApiEndpoint.get("mcp", "/api/mcp", { success: Json }))
  .add(
    HttpApiEndpoint.post("mcpConnect", "/api/experimental/mcp/:server/connect", {
      params: { server: Schema.String },
      success: NoContent,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.post("mcpDisconnect", "/api/experimental/mcp/:server/disconnect", {
      params: { server: Schema.String },
      success: NoContent,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(HttpApiEndpoint.get("mcpResource", "/api/mcp/resource", { success: Json }))
  .add(HttpApiEndpoint.get("projectList", "/api/project", { success: Json }))
  .add(
    HttpApiEndpoint.patch("projectUpdate", "/api/project/:projectID", {
      params: { projectID: Schema.String },
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(HttpApiEndpoint.get("configShells", "/api/config/shell", { success: Json }))
  .add(
    HttpApiEndpoint.patch("configUpdate", "/api/experimental/config", {
      payload: Schema.Struct({ shell: Schema.NullOr(Schema.String) }),
      success: HttpApiSchema.NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("websearchProviders", "/api/websearch/provider", { success: Json }))
  .add(
    HttpApiEndpoint.get("worktreeList", "/api/worktree", {
      query: Schema.Struct({ projectID: Schema.String }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("worktreeCreate", "/api/worktree", {
      payload: Worktree.CreateInput,
      success: Json,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.delete("worktreeRemove", "/api/worktree", {
      payload: Worktree.RemoveInput,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("worktreeRefresh", "/api/worktree/refresh", {
      payload: Schema.Struct({ projectID: Schema.String }),
      success: NoContent,
    }),
  )
  .add(HttpApiEndpoint.get("location", "/api/location", { success: Json }))
  .add(
    HttpApiEndpoint.get("permissionRequests", "/api/permission/request", {
      success: Json,
      error: MockInternal.pipe(HttpApiSchema.status(500)),
    }),
  )
  .add(HttpApiEndpoint.get("formRequests", "/api/form", { success: Json }))
  .add(HttpApiEndpoint.get("vcs", "/api/vcs", { success: Json }))
  .add(HttpApiEndpoint.post("vcsInit", "/api/vcs/init", { success: NoContent, error: Unsupported }))
  .add(HttpApiEndpoint.get("vcsStatus", "/api/vcs/status", { success: Json }))
  .add(HttpApiEndpoint.get("vcsBranches", "/api/vcs/branch", { success: Json }))
  .add(HttpApiEndpoint.get("vcsDiff", "/api/vcs/diff", { query: Query, success: Json }))
  .add(HttpApiEndpoint.get("fsList", "/api/fs/list", { query: Query, success: Json }))
  .add(
    HttpApiEndpoint.get("fsRead", "/api/fs/read/*", {
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    }),
  )
  .add(HttpApiEndpoint.get("fsFind", "/api/fs/find", { query: Query, success: Json }))
  .add(
    HttpApiEndpoint.post("fsWrite", "/api/experimental/fs/write", {
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: Json,
      error: Unsupported,
    }),
  )
  .add(HttpApiEndpoint.get("shell", "/api/shell", { success: Json }))
  .add(
    HttpApiEndpoint.get("shellOutput", "/api/shell/:id/output", {
      params: { id: Schema.String },
      success: Json,
      error: MockShellNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("shellRemove", "/api/shell/:id", {
      params: { id: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("ptyList", "/api/pty", {
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.post("ptyCreate", "/api/pty", {
      payload: Pty.CreateInput,
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.get("ptyGet", "/api/pty/:ptyID", {
      params: PtyParams,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.put("ptyUpdate", "/api/pty/:ptyID", {
      params: PtyParams,
      payload: Pty.UpdateInput,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.delete("ptyRemove", "/api/pty/:ptyID", {
      params: PtyParams,
      success: NoContent,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.post("ptyConnectToken", "/api/pty/:ptyID/connect-token", {
      params: PtyParams,
      success: Json,
      error: PtyMissing,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionList", "/api/session", {
      query: Query,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(HttpApiEndpoint.post("sessionCreate", "/api/session", { payload: JsonPayload, success: Json }))
  .add(HttpApiEndpoint.get("sessionActive", "/api/session/active", { success: Json }))
  .add(
    HttpApiEndpoint.get("sessionGet", "/api/session/:sessionID", {
      params: SessionParams,
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionRemove", "/api/session/:sessionID", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionShell", "/api/session/:sessionID/shell", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionForm", "/api/session/:sessionID/form", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionFormReply", "/api/session/:sessionID/form/:formID/reply", {
      params: { ...SessionParams, formID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionFormCancel", "/api/session/:sessionID/form/:formID", {
      params: { ...SessionParams, formID: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionBackground", "/api/session/:sessionID/background", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionInbox", "/api/session/:sessionID/inbox", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionPrompt", "/api/session/:sessionID/prompt", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionCompact", "/api/session/:sessionID/compact", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionCommand", "/api/session/:sessionID/command", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionGenerate", "/api/session/:sessionID/generate", {
      params: SessionParams,
      payload: Schema.Struct({ prompt: Schema.String }),
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionSwitchAgent", "/api/session/:sessionID/agent", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionSwitchModel", "/api/session/:sessionID/model", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionInboxCancel", "/api/session/:sessionID/inbox/:inboxID", {
      params: { ...SessionParams, inboxID: Schema.String },
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.patch("sessionInboxUpdate", "/api/session/:sessionID/inbox/:inboxID", {
      params: { ...SessionParams, inboxID: Schema.String },
      payload: Schema.Struct({ delivery: Schema.Literals(["steer", "queue"]) }),
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("sessionPermission", "/api/session/:sessionID/permission", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionPermissionReply", "/api/session/:sessionID/permission/:permissionID/reply", {
      params: { ...SessionParams, permissionID: Schema.String },
      payload: JsonPayload,
      success: NoContent,
      error: Unsupported,
    }),
  )
  .add(
    HttpApiEndpoint.patch("sessionRename", "/api/session/:sessionID", {
      params: SessionParams,
      payload: JsonPayload,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionInterrupt", "/api/session/:sessionID/interrupt", {
      params: SessionParams,
      success: Json,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionWait", "/api/experimental/session/:sessionID/wait", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionRevertStage", "/api/session/:sessionID/revert/stage", {
      params: SessionParams,
      payload: JsonPayload,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )
  .add(
    HttpApiEndpoint.delete("sessionRevertClear", "/api/session/:sessionID/revert", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.post("sessionRevertCommit", "/api/session/:sessionID/revert/commit", {
      params: SessionParams,
      success: NoContent,
    }),
  )
  .add(
    HttpApiEndpoint.get("messageGet", "/api/session/:sessionID/message/:messageID", {
      params: { ...SessionParams, messageID: Schema.String },
      success: Json,
      error: MockNotFound.pipe(HttpApiSchema.status(404)),
    }),
  )
  .add(
    HttpApiEndpoint.get("messageList", "/api/session/:sessionID/message", {
      params: SessionParams,
      query: Query,
      success: Json,
      error: MockBadRequest.pipe(HttpApiSchema.status(400)),
    }),
  )

export const MockApi = HttpApi.make("mock").add(Group)
