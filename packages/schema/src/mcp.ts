export * as Mcp from "./mcp.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "./schema.js"
import { IntegrationID } from "./integration-id.js"

export class TimeoutConfig extends Schema.Class<TimeoutConfig>("Mcp.TimeoutConfig")({
  startup: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds to establish and initialize the MCP server.",
  }),
  catalog: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds to wait for MCP discovery requests such as tools/list and prompts/list.",
  }),
  execution: PositiveInt.pipe(optional).annotate({
    description: "Maximum time in milliseconds to wait for MCP tool and prompt execution.",
  }),
}) {}

export type Protocol = typeof Protocol.Type
export const Protocol = Schema.Literals(["legacy", "auto", "2026-07-28"]).annotate({
  identifier: "Mcp.Protocol",
  description:
    'MCP protocol negotiation. "legacy" (default) opens with the initialize handshake and speaks protocol revisions up to 2025-11-25. "auto" probes for the 2026-07-28 revision and falls back to legacy when the server does not support it. "2026-07-28" requires that revision and fails otherwise.',
})

export class LocalConfig extends Schema.Class<LocalConfig>("Mcp.LocalConfig")({
  type: Schema.Literal("local"),
  command: Schema.String.pipe(Schema.Array),
  cwd: Schema.String.pipe(optional).annotate({
    description: "Working directory for the MCP server process. Relative paths resolve from the workspace directory.",
  }),
  environment: Schema.Record(Schema.String, Schema.String).pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  codemode: Schema.Boolean.pipe(optional).annotate({
    description: "Expose this server's tools through Code Mode. Defaults to true.",
  }),
  timeout: TimeoutConfig.pipe(optional),
  protocol: Protocol.pipe(optional),
}) {}

export class OAuthConfig extends Schema.Class<OAuthConfig>("Mcp.OAuthConfig")({
  client_id: Schema.String.pipe(optional),
  client_secret: Schema.String.pipe(optional),
  scope: Schema.String.pipe(optional),
  callback_port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(optional),
  redirect_uri: Schema.String.pipe(optional),
  auth_server_metadata_url: Schema.String.pipe(optional).annotate({
    description:
      "URL of the OAuth or OpenID Connect authorization server metadata document. Set when the MCP server does not publish protected resource metadata that names its authorization server.",
  }),
}) {}

export class RemoteConfig extends Schema.Class<RemoteConfig>("Mcp.RemoteConfig")({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String).pipe(optional),
  oauth: Schema.Union([OAuthConfig, Schema.Literal(false)]).pipe(optional),
  disabled: Schema.Boolean.pipe(optional),
  codemode: Schema.Boolean.pipe(optional).annotate({
    description: "Expose this server's tools through Code Mode. Defaults to true.",
  }),
  timeout: TimeoutConfig.pipe(optional),
  protocol: Protocol.pipe(optional),
}) {}

export const ServerConfig = Schema.Union([LocalConfig, RemoteConfig]).pipe(Schema.toTaggedUnion("type"))
export type ServerConfig = typeof ServerConfig.Type

/**
 * A remote MCP server's identity for policy: lowercase origin without a default port or a trailing root dot, then
 * the path without trailing or repeated slashes and with unreserved characters decoded. Credentials, the query and
 * the fragment are dropped. Undefined unless `raw` is an `http:` or `https:` URL.
 */
export function normalizeUrl(raw: string) {
  const url = parseUrl(raw)
  return url && `${url.protocol}//${url.host}${url.path}`
}

/**
 * Whether a server URL matches a policy pattern. `*` matches every server, including local ones without a URL.
 * Otherwise the pattern is a URL compared component by component: the scheme exactly, the host (with any port)
 * as a `*` wildcard, then the path. A pattern without a path covers the whole host, a path with `*` must match
 * the whole path (a trailing `/*` also matches the path before it), and a literal path matches itself and the
 * paths below it.
 */
export function matchUrl(serverUrl: string | undefined, pattern: string) {
  if (pattern.trim() === "*") return true
  const server = serverUrl === undefined ? undefined : parseUrl(serverUrl)
  const expected = parseUrl(pattern)
  if (!server || !expected || server.protocol !== expected.protocol) return false
  if (!wildcard(expected.host).test(server.host)) return false
  if (expected.path === "") return true
  if (expected.path.includes("*"))
    return (
      wildcard(expected.path).test(server.path) ||
      (expected.path.endsWith("/*") && wildcard(expected.path.slice(0, -2)).test(server.path))
    )
  return server.path === expected.path || server.path.startsWith(`${expected.path}/`)
}

// Credentials are not part of a server's identity, so they are dropped rather than rejected.
function parseUrl(raw: string) {
  const url = URL.parse(raw.trim())
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return undefined
  // DNS and TLS treat a host with one trailing root dot as the same host.
  const hostname = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname
  if (hostname === "" || hostname.endsWith(".")) return undefined
  return {
    protocol: url.protocol,
    host: url.port ? `${hostname}:${url.port}` : hostname,
    path: url.pathname
      .replace(/%[0-9a-f]{2}/gi, (code) => {
        const char = String.fromCharCode(Number.parseInt(code.slice(1), 16))
        return /[\w.~-]/.test(char) ? char : code.toUpperCase()
      })
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, ""),
  }
}

function wildcard(pattern: string) {
  const parts = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp(`^${parts.join(".*")}$`)
}

const Connected = Schema.Struct({ status: Schema.Literal("connected") }).annotate({
  identifier: "Mcp.Status.Connected",
})
const Pending = Schema.Struct({ status: Schema.Literal("pending") }).annotate({
  identifier: "Mcp.Status.Pending",
})
const Disabled = Schema.Struct({ status: Schema.Literal("disabled") }).annotate({
  identifier: "Mcp.Status.Disabled",
})
const Failed = Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).annotate({
  identifier: "Mcp.Status.Failed",
})
const NeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth"), error: Schema.String }).annotate({
  identifier: "Mcp.Status.NeedsAuth",
})

export type Status = typeof Status.Type
export const Status = Schema.Union([Connected, Pending, Disabled, Failed, NeedsAuth]).pipe(
  Schema.toTaggedUnion("status"),
)

export interface Server extends Schema.Schema.Type<typeof Server> {}
export const Server = Schema.Struct({
  name: Schema.String,
  status: Status,
  // Display title from the connected server's `serverInfo.title`; absent while disconnected or when not provided.
  title: optional(Schema.String),
  // Set for remote servers registered as OAuth integrations; lets clients act on the right integration
  // without matching by name, which could collide with provider or plugin integrations.
  integrationID: optional(IntegrationID),
}).annotate({ identifier: "Mcp.Server" })

export interface Resource extends Schema.Schema.Type<typeof Resource> {}
export const Resource = Schema.Struct({
  server: Schema.String,
  name: Schema.String,
  uri: Schema.String,
  description: optional(Schema.String),
  mimeType: optional(Schema.String),
}).annotate({ identifier: "Mcp.Resource" })

export interface ResourceTemplate extends Schema.Schema.Type<typeof ResourceTemplate> {}
export const ResourceTemplate = Schema.Struct({
  server: Schema.String,
  name: Schema.String,
  uriTemplate: Schema.String,
  description: optional(Schema.String),
  mimeType: optional(Schema.String),
}).annotate({ identifier: "Mcp.ResourceTemplate" })

export interface ResourceCatalog extends Schema.Schema.Type<typeof ResourceCatalog> {}
export const ResourceCatalog = Schema.Struct({
  resources: Schema.Array(Resource),
  templates: Schema.Array(ResourceTemplate),
}).annotate({ identifier: "Mcp.ResourceCatalog" })

export const ResourceContentPart = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    uri: Schema.String,
    text: Schema.String,
    mimeType: optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("blob"),
    uri: Schema.String,
    blob: Schema.String,
    mimeType: optional(Schema.String),
  }),
]).pipe(Schema.toTaggedUnion("type"), Schema.annotate({ identifier: "Mcp.ResourceContentPart" }))
export type ResourceContentPart = typeof ResourceContentPart.Type

export interface ResourceContent extends Schema.Schema.Type<typeof ResourceContent> {}
export const ResourceContent = Schema.Struct({
  server: Schema.String,
  uri: Schema.String,
  contents: Schema.Array(ResourceContentPart),
}).annotate({ identifier: "Mcp.ResourceContent" })
