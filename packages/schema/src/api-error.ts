import { Schema } from "effect"

export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()(
  "InvalidCursorError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  { sessionID: Schema.String, message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class UnknownError extends Schema.TaggedError<UnknownError>()(
  "UnknownError",
  { message: Schema.String, ref: Schema.optional(Schema.String) },
  { httpApiStatus: 500 },
) {}
