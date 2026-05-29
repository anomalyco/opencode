import { RequestError } from "@agentclientprotocol/sdk"
import { Schema } from "effect"

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "ACPSessionNotFoundError",
  {
    sessionId: Schema.String,
  },
) {}

export class InvalidConfigOptionError extends Schema.TaggedErrorClass<InvalidConfigOptionError>()(
  "ACPInvalidConfigOptionError",
  {
    configId: Schema.String,
  },
) {}

export class InvalidModelError extends Schema.TaggedErrorClass<InvalidModelError>()("ACPInvalidModelError", {
  modelId: Schema.String,
  providerId: Schema.optional(Schema.String),
}) {}

export class InvalidEffortError extends Schema.TaggedErrorClass<InvalidEffortError>()("ACPInvalidEffortError", {
  effort: Schema.String,
}) {}

export class InvalidModeError extends Schema.TaggedErrorClass<InvalidModeError>()("ACPInvalidModeError", {
  mode: Schema.String,
}) {}

export class AuthRequiredError extends Schema.TaggedErrorClass<AuthRequiredError>()("ACPAuthRequiredError", {
  providerId: Schema.optional(Schema.String),
}) {}

export class UnknownAuthMethodError extends Schema.TaggedErrorClass<UnknownAuthMethodError>()(
  "ACPUnknownAuthMethodError",
  {
    methodId: Schema.String,
  },
) {}

export class UnsupportedOperationError extends Schema.TaggedErrorClass<UnsupportedOperationError>()(
  "ACPUnsupportedOperationError",
  {
    method: Schema.String,
  },
) {}

export class ServiceFailureError extends Schema.TaggedErrorClass<ServiceFailureError>()("ACPServiceFailureError", {
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
    case "ACPSessionNotFoundError":
      return RequestError.invalidParams({ sessionId: error.sessionId }, `session not found: ${error.sessionId}`)
    case "ACPInvalidConfigOptionError":
      return RequestError.invalidParams({ configId: error.configId }, `unknown config option: ${error.configId}`)
    case "ACPInvalidModelError":
      return RequestError.invalidParams(
        { providerId: error.providerId, modelId: error.modelId },
        `model not found: ${error.modelId}`,
      )
    case "ACPInvalidEffortError":
      return RequestError.invalidParams({ effort: error.effort }, `effort not found: ${error.effort}`)
    case "ACPInvalidModeError":
      return RequestError.invalidParams({ mode: error.mode }, `mode not found: ${error.mode}`)
    case "ACPAuthRequiredError":
      return RequestError.authRequired({ providerId: error.providerId }, "provider authentication required")
    case "ACPUnknownAuthMethodError":
      return RequestError.invalidParams({ methodId: error.methodId }, `unknown auth method: ${error.methodId}`)
    case "ACPUnsupportedOperationError":
      return RequestError.methodNotFound(error.method)
    case "ACPServiceFailureError":
      return RequestError.internalError({ service: error.service }, error.safeMessage)
  }
}

export function fromUnknownDefect(_defect: unknown, safeMessage = "Internal service failure") {
  return new ServiceFailureError({ safeMessage })
}
