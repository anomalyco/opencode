export * as ConfigMCPV1 from "./mcp"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

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
}).annotate({ identifier: "McpRemoteConfig" })
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote]).annotate({ discriminator: "type" })
export type Info = Schema.Schema.Type<typeof Info>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Vendors publish MCP snippets in shorthand forms (Claude Desktop, VS Code, Gemini CLI):
// `{"command": "npx", "args": [...], "env": {...}}` or `{"httpUrl": "..."}`. Expand those
// into the canonical tagged form so users can paste vendor docs without hand-translating.
export function normalizeServer(input: unknown): unknown {
  if (!isRecord(input) || "type" in input) return input

  if ("command" in input || "args" in input) {
    const args = Array.isArray(input.args) ? input.args : []
    const command = typeof input.command === "string" ? [input.command, ...args] : Array.isArray(input.command) ? [...input.command, ...args] : undefined
    if (!command) return input
    return {
      type: "local",
      command,
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.env !== undefined ? { environment: input.env } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
    }
  }

  const url = typeof input.url === "string" ? input.url : typeof input.httpUrl === "string" ? input.httpUrl : undefined
  if (url) {
    return {
      type: "remote",
      url,
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
      ...(input.oauth !== undefined ? { oauth: input.oauth } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
    }
  }

  return input
}

export function normalizeServers(servers: unknown): unknown {
  if (!isRecord(servers)) return servers
  return Object.fromEntries(Object.entries(servers).map(([name, spec]) => [name, normalizeServer(spec)]))
}
