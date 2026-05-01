import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export class Local extends Schema.Class<Local>("McpLocalConfig")({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
}) {
  static readonly zod = zod(this)
}

export class OAuth extends Schema.Class<OAuth>("McpOAuthConfig")({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
}) {
  static readonly zod = zod(this)
}

export class Remote extends Schema.Class<Remote>("McpRemoteConfig")({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "URL of the remote MCP server" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
}) {
  static readonly zod = zod(this)
}

export const Info = Schema.Union([Local, Remote])
  .annotate({ discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMCP from "./mcp"
