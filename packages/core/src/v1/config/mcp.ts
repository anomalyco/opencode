export * as ConfigMCPV1 from "./mcp"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const ProtocolMode = Schema.Union([
  Schema.Literal("legacy"),
  Schema.Literal("auto"),
  Schema.Literal("modern"),
]).annotate({
  identifier: "McpProtocolMode",
  description:
    "MCP protocol era negotiation. 'legacy' always uses the pre-2026-07-28 initialize handshake (the safe default for " +
    "most servers today). 'auto' probes server/discover and falls back to legacy — use for servers you know or expect " +
    "may support the 2026-07-28 revision. 'modern' pins strictly to the latest protocol revision and fails rather than " +
    "falling back — mainly useful for test fixtures. Falls back to `experimental.mcp_protocol_mode`, then 'auto'.",
})
export type ProtocolMode = Schema.Schema.Type<typeof ProtocolMode>

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory for the MCP server process. Relative paths resolve from the workspace directory.",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  protocolMode: Schema.optional(ProtocolMode),
  toolProfile: Schema.optional(Schema.String).annotate({
    description:
      "Name of an entry in the top-level `mcpToolProfiles` map. When set, only the listed tool names from this " +
      "server are exposed to the model; all others are filtered out before tool definitions are built.",
  }),
}).annotate({ identifier: "McpLocalConfig" })
export type Local = Schema.Schema.Type<typeof Local>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  callbackPort: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))).annotate({
    description:
      "Port for the local OAuth callback server (default: 19876). Shorthand for redirectUri when only the port needs changing. Ignored if redirectUri is set.",
  }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: "OAuth redirect URI (default: http://127.0.0.1:19876/mcp/oauth/callback).",
  }),
}).annotate({ identifier: "McpOAuthConfig" })
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const Remote = Schema.Struct({
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
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Timeout in ms for MCP server requests. Defaults to 5000 (5 seconds) if not specified.",
  }),
  protocolMode: Schema.optional(ProtocolMode),
  toolProfile: Schema.optional(Schema.String).annotate({
    description:
      "Name of an entry in the top-level `mcpToolProfiles` map. When set, only the listed tool names from this " +
      "server are exposed to the model; all others are filtered out before tool definitions are built.",
  }),
}).annotate({ identifier: "McpRemoteConfig" })
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote]).annotate({ discriminator: "type" })
export type Info = Schema.Schema.Type<typeof Info>
