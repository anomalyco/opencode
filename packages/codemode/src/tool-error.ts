import { Cause, Formatter, Schema } from "effect"

/** Tool failure reported as `ToolFailure`, with optional underlying context. */
export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** Creates a tool failure with an optional underlying cause. */
export const toolError = (message: string, cause?: unknown): ToolError =>
  new ToolError({ message, ...(cause === undefined ? {} : { cause }) })

/** Joins error messages, nested causes, and aggregate failures without stack frames. */
export function errorMessage(error: unknown): string {
  return [...new Set(errorMessages(error))].filter((message) => message !== "").join("\n")
}

function errorMessages(error: unknown): string[] {
  if (Cause.isCause(error)) {
    return error.reasons.flatMap((reason) =>
      errorMessages(Cause.isFailReason(reason) ? reason.error : Cause.isDieReason(reason) ? reason.defect : reason),
    )
  }
  if (error instanceof Error) {
    const messages = [
      error.message,
      ...(error.cause === undefined ? [] : errorMessages(error.cause)),
      ...(error instanceof AggregateError ? error.errors.flatMap(errorMessages) : []),
    ]
    return messages.some((message) => message !== "") || error.name === "Error" ? messages : [error.name]
  }
  return [typeof error === "string" ? error : Formatter.format(error)]
}
