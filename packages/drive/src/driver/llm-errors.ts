import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

/** Rejection of an LLM control call made in an incompatible response mode. */
export class LlmModeError extends Schema.TaggedErrorClass<LlmModeError>()(
  "LlmModeError",
  {
    operation: Schema.Literals(["queue", "send", "serve", "title"]),
    message: Schema.String,
  },
) {}

/** Failure of an LLM controller operation or its backend connection. */
export class LlmControllerError extends Schema.TaggedErrorClass<LlmControllerError>()(
  "LlmControllerError",
  {
    operation: Schema.String,
    requestId: Schema.optionalKey(Schema.String),
    message: Schema.String,
  },
) {}

/** Settlement ended with unused responses or unexpected requests. */
export class LlmSettlementError extends Schema.TaggedErrorClass<LlmSettlementError>()(
  "LlmSettlementError",
  {
    unusedResponses: Schema.Number,
    unexpectedRequests: Schema.Number,
    message: Schema.String,
  },
) {}

/** Coerces any cause into an `LlmControllerError`, preserving existing ones. */
export const controllerError = (
  operation: string,
  cause: unknown,
  requestId?: string,
): LlmControllerError => {
  if (cause instanceof LlmControllerError) return cause
  return new LlmControllerError({
    operation,
    ...(requestId === undefined ? {} : { requestId }),
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

/** Extracts the most useful failure from a cause and coerces it. */
export const causeError = (
  operation: string,
  cause: Cause.Cause<unknown>,
  requestId?: string,
): LlmControllerError => {
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure)
    ? controllerError(operation, failure.value, requestId)
    : controllerError(operation, Cause.squash(cause), requestId)
}
