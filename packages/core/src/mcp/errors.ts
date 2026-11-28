export * as McpError from "./errors.js"

import { Schema } from "effect"

// Kept free of the MCP SDK so modules that load at startup can match these errors without loading it.

export class NeedsAuthError extends Schema.TaggedError<NeedsAuthError>()("MCP.NeedsAuthError", {
  server: Schema.String,
  message: Schema.String,
}) {}

/** A server's config can't be used as written, so it is never connected or offered for sign-in. */
export class InvalidConfigError extends Schema.TaggedError<InvalidConfigError>()("MCP.InvalidConfigError", {
  server: Schema.String,
  message: Schema.String,
}) {}

export class ConnectError extends Schema.TaggedError<ConnectError>()("MCP.ConnectError", {
  server: Schema.String,
  message: Schema.String,
  /** The server was reached but refused or broke the handshake, so different connect options might succeed. */
  answered: Schema.optional(Schema.Boolean),
}) {}

/** A legacy Streamable HTTP server no longer recognizes this connection's session; the lifecycle reconnects. */
export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError>()("MCP.SessionExpiredError", {
  server: Schema.String,
}) {
  override get message() {
    return `MCP server session expired: ${this.server}`
  }
}

/** A skill file the server served doesn't match its entry: not listed, or a different size, digest or frontmatter. */
export class SkillMismatchError extends Schema.TaggedError<SkillMismatchError>()("McpClient.SkillMismatchError", {
  uri: Schema.String,
  check: Schema.Literals(["unlisted", "size", "digest", "frontmatter"]),
  message: Schema.String,
}) {}
