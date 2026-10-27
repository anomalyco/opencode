import { Schema } from "effect"
import { Skill } from "@opencode/schema/skill"
import { Location } from "@opencode/schema/location"

export class LocationNotFoundError extends Schema.TaggedError<LocationNotFoundError>()(
  "LocationNotFoundError",
  { location: Location.PublicRef, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  "InvalidRequestError",
  {
    message: Schema.String,
    kind: Schema.optional(Schema.String),
    field: Schema.optional(Schema.String),
  },
  { httpApiStatus: 400 },
) {}

export class RpcError extends Schema.TaggedError<RpcError>()(
  "RpcError",
  {
    type: Schema.String,
    message: Schema.String,
    data: Schema.optional(Schema.Unknown),
  },
  { httpApiStatus: 400 },
) {}

export class RpcInternalError extends Schema.TaggedError<RpcInternalError>()(
  "RpcInternalError",
  {
    type: Schema.Literals(["rpc.internal", "rpc.invalid_output"]),
    message: Schema.String,
    data: Schema.optional(Schema.Unknown),
  },
  { httpApiStatus: 500 },
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
  { httpApiStatus: 409 },
) {}

export class SessionBusyError extends Schema.TaggedError<SessionBusyError>()(
  "SessionBusyError",
  {
    sessionID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class ServiceUnavailableError extends Schema.TaggedError<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  {
    message: Schema.String,
    service: Schema.optional(Schema.String),
  },
  { httpApiStatus: 503 },
) {}

export class UnknownError extends Schema.TaggedError<UnknownError>()(
  "UnknownError",
  {
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

export class ProviderNotFoundError extends Schema.TaggedError<ProviderNotFoundError>()(
  "ProviderNotFoundError",
  {
    providerID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class IntegrationNotFoundError extends Schema.TaggedError<IntegrationNotFoundError>()(
  "IntegrationNotFoundError",
  {
    integrationID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class IntegrationAttemptNotFoundError extends Schema.TaggedError<IntegrationAttemptNotFoundError>()(
  "IntegrationAttemptNotFoundError",
  {
    integrationID: Schema.String,
    attemptID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class IntegrationMethodNotFoundError extends Schema.TaggedError<IntegrationMethodNotFoundError>()(
  "IntegrationMethodNotFoundError",
  {
    integrationID: Schema.String,
    methodID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ProjectNotFoundError extends Schema.TaggedError<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  {
    projectID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class FileNotFoundError extends Schema.TaggedError<FileNotFoundError>()(
  "FileNotFoundError",
  {
    path: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class PluginNotFoundError extends Schema.TaggedError<PluginNotFoundError>()(
  "PluginNotFoundError",
  {
    pluginID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}
export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()(
  "AgentNotFoundError",
  {
    agentID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    sessionID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class MessageNotFoundError extends Schema.TaggedError<MessageNotFoundError>()(
  "MessageNotFoundError",
  {
    sessionID: Schema.String,
    messageID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class SkillNotFoundError extends Schema.TaggedError<SkillNotFoundError>()(
  "SkillNotFoundError",
  {
    skill: Skill.ID,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class McpServerNotFoundError extends Schema.TaggedError<McpServerNotFoundError>()(
  "McpServerNotFoundError",
  {
    server: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class CommandNotFoundError extends Schema.TaggedError<CommandNotFoundError>()(
  "CommandNotFoundError",
  {
    command: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class CommandExecutionError extends Schema.TaggedError<CommandExecutionError>()(
  "CommandExecutionError",
  {
    command: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 500 },
) {}

export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()(
  "InvalidCursorError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class PermissionNotFoundError extends Schema.TaggedError<PermissionNotFoundError>()(
  "PermissionNotFoundError",
  {
    requestID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class PermissionSavedNotFoundError extends Schema.TaggedError<PermissionSavedNotFoundError>()(
  "PermissionSavedNotFoundError",
  {
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class FormNotFoundError extends Schema.TaggedError<FormNotFoundError>()(
  "FormNotFoundError",
  {
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class FormAlreadySettledError extends Schema.TaggedError<FormAlreadySettledError>()(
  "FormAlreadySettledError",
  {
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class FormInvalidAnswerError extends Schema.TaggedError<FormInvalidAnswerError>()(
  "FormInvalidAnswerError",
  {
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}

export class PtyNotFoundError extends Schema.TaggedError<PtyNotFoundError>()(
  "PtyNotFoundError",
  {
    ptyID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ShellNotFoundError extends Schema.TaggedError<ShellNotFoundError>()(
  "ShellNotFoundError",
  {
    id: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()(
  "ModelNotFoundError",
  {
    providerID: Schema.String,
    modelID: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

/** The model exists but cannot serve this request, such as a chat model asked for images. */
export class UnsupportedModelError extends Schema.TaggedError<UnsupportedModelError>()(
  "UnsupportedModelError",
  {
    providerID: Schema.String,
    modelID: Schema.String,
    capability: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 422 },
) {}

/** The provider rejected or failed the request after the server sent it. */
export class ProviderRequestError extends Schema.TaggedError<ProviderRequestError>()(
  "ProviderRequestError",
  {
    providerID: Schema.String,
    reason: Schema.Literals([
      "authentication",
      "rate_limit",
      "content_filter",
      "invalid_request",
      "overloaded",
      "provider",
    ]),
    message: Schema.String,
    status: Schema.optional(Schema.Int),
    retryAfterMs: Schema.optional(Schema.Int),
  },
  { httpApiStatus: 502 },
) {}
