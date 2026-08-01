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

/**
 * The legacy shorthand for switching a server off without deleting its
 * definition: `{ "enabled": false }`.
 *
 * Effect Schema drops excess properties, so a plain `{ enabled: boolean }`
 * struct would match *any* object carrying a boolean `enabled` and reduce it
 * to just that key — a half-written entry would decode cleanly And command`/`url` would vanish.
 *  Keep the extra keys long enough to
 * reject them here; `entryIssues` below is what turns the same shapes into
 * actionable diagnostics before decode.
 */
export const Disabled = Schema.StructWithRest(Schema.Struct({ enabled: Schema.Boolean }), [
  Schema.Record(Schema.String, Schema.Unknown),
])
  .pipe(
    Schema.check(
      Schema.makeFilter(
        (entry) => Object.keys(entry).length === 1 || 'expected `{ "enabled": boolean }` as the only key',
        { description: 'Disable a server with `{ "enabled": false }`' },
      ),
    ),
  )
  .annotate({ identifier: "McpDisabledConfig" })
export type Disabled = Schema.Schema.Type<typeof Disabled>

export const Entry = Schema.Union([Info, Disabled])
export type Entry = Schema.Schema.Type<typeof Entry>

const LOCAL_KEYS = ["type", "command", "environment", "enabled", "timeout"]
const REMOTE_KEYS = ["type", "url", "enabled", "headers", "oauth", "timeout"]

// Names other MCP clients and the spec itself use, mapped to ours. These are
// what users arrive with from Claude Desktop, Cursor, and the MCP docs.
const TYPE_ALIASES: Record<string, "local" | "remote"> = {
  stdio: "local",
  command: "local",
  sse: "remote",
  http: "remote",
  https: "remote",
  "streamable-http": "remote",
  streamablehttp: "remote",
}
const KEY_ALIASES: Record<string, string> = {
  env: "environment",
  envs: "environment",
  environmentVariables: "environment",
  args: "command",
  header: "headers",
  endpoint: "url",
}

function unknownKeyIssue(key: string, allowed: string[]) {
  const alias = KEY_ALIASES[key]
  if (alias && allowed.includes(alias)) return `unknown key "${key}" — did you mean "${alias}"?`
  return `unknown key "${key}" — expected one of: ${allowed.join(", ")}`
}

/**
 * Actionable problems with a single raw `mcp` entry, as written by the user and
 * *before* decoding. Anything reported here would otherwise vanish silently.
 *
 * Deliberately does not re-check what the schema already reports well (a
 * missing `command`, a non-string `url`). It covers the two gaps: keys the
 * decoder would discard, and entries the `{ enabled }` arm would swallow whole.
 */
export function entryIssues(entry: unknown): string[] {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return [`must be an object with a "type" of "local" or "remote"`]
  }

  const keys = Object.keys(entry)
  const type = (entry as Record<string, unknown>)["type"]

  if (type === "local") {
    return keys.filter((key) => !LOCAL_KEYS.includes(key)).map((key) => unknownKeyIssue(key, LOCAL_KEYS))
  }
  if (type === "remote") {
    return keys.filter((key) => !REMOTE_KEYS.includes(key)).map((key) => unknownKeyIssue(key, REMOTE_KEYS))
  }
  if (typeof type === "string") {
    const alias = TYPE_ALIASES[type.toLowerCase()]
    if (alias) return [`unknown type "${type}" — this project calls that "${alias}"`]
    return [`unknown type "${type}" — expected "local" or "remote"`]
  }
  if (type !== undefined) return [`"type" must be the string "local" or "remote"`]

  // No `type`. The only legal shape is the legacy disable shorthand, and only
  // when `enabled` is the *sole* key — otherwise the rest would be discarded.
  if (keys.length === 1 && keys[0] === "enabled") {
    const enabled = (entry as Record<string, unknown>)["enabled"]
    if (enabled === true) {
      return [
        `"enabled": true on its own does not define a server — add "type" and "command" (local) or "url" (remote)`,
      ]
    }
    // `false` is the legacy disable shorthand; a non-boolean is the schema's to report.
    return []
  }

  const hint = keys.includes("url")
    ? ` — entries with a "url" are "remote"`
    : keys.includes("command")
      ? ` — entries with a "command" are "local"`
      : ""
  if (keys.includes("enabled")) {
    const rest = keys.filter((key) => key !== "enabled")
    return [
      `missing "type"${hint}; only \`{ "enabled": false }\` alone may omit it, ` +
        `so ${rest.map((key) => `"${key}"`).join(", ")} would be discarded`,
    ]
  }
  return [`missing "type": expected "local" or "remote"${hint}`]
}

/** Every problem across the raw `mcp` record, keyed by server name. */
export function issues(mcp: unknown): Array<{ key: string; message: string }> {
  if (typeof mcp !== "object" || mcp === null || Array.isArray(mcp)) return []
  return Object.entries(mcp).flatMap(([key, entry]) => entryIssues(entry).map((message) => ({ key, message })))
}

export * as ConfigMCP from "./mcp"
