import { Schema } from "effect"

/** The location's environment cannot serve filesystem operations, such as a bare Location with no execution plane. */
export class UnavailableError extends Schema.TaggedError<UnavailableError>()("FileSystem.UnavailableError", {
  message: Schema.String,
}) {}
