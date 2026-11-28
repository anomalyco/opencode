import { Schema } from "effect"

/** Tool failure reported as `ToolFailure`. */
export class ToolError extends Schema.TaggedError<ToolError>()("ToolError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/** Creates a tool failure with an optional underlying cause. */
export const toolError = (message: string, cause?: unknown): ToolError =>
  new ToolError({ message, ...(cause === undefined ? {} : { cause }) })
