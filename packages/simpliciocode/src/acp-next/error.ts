import { RequestError } from "@agentclientprotocol/sdk"
import { Schema } from "effect"

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "ACPNextSessionNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

export class InvalidConfigOptionError extends Schema.TaggedErrorClass<InvalidConfigOptionError>()(
  "ACPNextInvalidConfigOptionError",
  {
    configId: Schema.String,
  },
) {}

export class InvalidModelError extends Schema.TaggedErrorClass<InvalidModelError>()("ACPNextInvalidModelError", {
  modelId: Schema.String,
  providerId: Schema.optional(Schema.String),
}) {}

export class InvalidEffortError extends Schema.TaggedErrorClass<InvalidEffortError>()("ACPNextInvalidEffortError", {
  effort: Schema.String,
}) {}

export class InvalidModeError extends Schema.TaggedErrorClass<InvalidModeError>()("ACPNextInvalidModeError", {
  mode: Schema.String,
}) {}

export class AuthRequiredError extends Schema.TaggedErrorClass<AuthRequiredError>()("ACPNextAuthRequiredError", {
  providerId: Schema.optional(Schema.String),
}) {}

export class UnknownAuthMethodError extends Schema.TaggedErrorClass<UnknownAuthMethodError>()(
  "ACPNextUnknownAuthMethodError",
  {
    methodId: Schema.String,
  },
) {}

export class UnsupportedOperationError extends Schema.TaggedErrorClass<UnsupportedOperationError>()(
  "ACPNextUnsupportedOperationError",
  {
    method: Schema.String,
  },
) {}

export class ServiceFailureError extends Schema.TaggedErrorClass<ServiceFailureError>()("ACPNextServiceFailureError", {
  safeMessage: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error =
  | SessionNotFoundError
  | InvalidConfigOptionError
  | InvalidModelError
  | InvalidEffortError
  | InvalidModeError
  | AuthRequiredError
  | UnknownAuthMethodError
  | UnsupportedOperationError
  | ServiceFailureError

export function toRequestError(error: Error) {
  switch (error._tag) {
    case "ACPNextSessionNotFoundError":
      return RequestError.invalidParams({ sessionId: error.sessionId }, `session not found: ${error.sessionId}`)
    case "ACPNextInvalidConfigOptionError":
      return RequestError.invalidParams({ configId: error.configId }, `unknown config option: ${error.configId}`)
    case "ACPNextInvalidModelError":
      return RequestError.invalidParams(
        { providerId: error.providerId, modelId: error.modelId },
        `model not found: ${error.modelId}`,
      )
    case "ACPNextInvalidEffortError":
      return RequestError.invalidParams({ effort: error.effort }, `effort not found: ${error.effort}`)
    case "ACPNextInvalidModeError":
      return RequestError.invalidParams({ mode: error.mode }, `mode not found: ${error.mode}`)
    case "ACPNextAuthRequiredError":
      return RequestError.authRequired({ providerId: error.providerId }, "provider authentication required")
    case "ACPNextUnknownAuthMethodError":
      return RequestError.invalidParams({ methodId: error.methodId }, `unknown auth method: ${error.methodId}`)
    case "ACPNextUnsupportedOperationError":
      return RequestError.methodNotFound(error.method)
    case "ACPNextServiceFailureError":
      return RequestError.internalError({ service: error.service }, error.safeMessage)
  }
}

export function fromUnknownDefect(_defect: unknown, safeMessage = "Internal service failure") {
  return new ServiceFailureError({ safeMessage })
}
