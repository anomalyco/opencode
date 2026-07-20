export * as Mcp from "./mcp.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "./schema.js"
import { IntegrationID } from "./integration-id.js"

export class TimeoutConfig extends Schema.Class<TimeoutConfig>("Mcp.TimeoutConfig")({
  startup: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum time in milliseconds to establish and initialize the MCP server.",
  }),
  catalog: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum time in milliseconds to wait for MCP discovery requests such as tools/list and prompts/list.",
  }),
  execution: PositiveInt.pipe(Schema.optional).annotate({
    description: "Maximum time in milliseconds to wait for MCP tool and prompt execution.",
  }),
}) {}

export class LocalConfig extends Schema.Class<LocalConfig>("Mcp.LocalConfig")({
  type: Schema.Literal("local"),
  command: Schema.String.pipe(Schema.Array),
  cwd: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory for the MCP server process. Relative paths resolve from the workspace directory.",
  }),
  environment: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  codemode: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Expose this server's tools through Code Mode. Defaults to true.",
  }),
  timeout: TimeoutConfig.pipe(Schema.optional),
}) {}

export class OAuthConfig extends Schema.Class<OAuthConfig>("Mcp.OAuthConfig")({
  client_id: Schema.String.pipe(Schema.optional),
  client_secret: Schema.String.pipe(Schema.optional),
  scope: Schema.String.pipe(Schema.optional),
  callback_port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(Schema.optional),
  redirect_uri: Schema.String.pipe(Schema.optional),
}) {}

export class RemoteConfig extends Schema.Class<RemoteConfig>("Mcp.RemoteConfig")({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  oauth: Schema.Union([OAuthConfig, Schema.Literal(false)]).pipe(Schema.optional),
  disabled: Schema.Boolean.pipe(Schema.optional),
  codemode: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Expose this server's tools through Code Mode. Defaults to true.",
  }),
  timeout: TimeoutConfig.pipe(Schema.optional),
}) {}

export const ServerConfig = Schema.Union([LocalConfig, RemoteConfig]).pipe(Schema.toTaggedUnion("type"))
export type ServerConfig = typeof ServerConfig.Type

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
const NeedsAuth = Schema.Struct({ status: Schema.Literal("needs_auth") }).annotate({
  identifier: "Mcp.Status.NeedsAuth",
})
const NeedsClientRegistration = Schema.Struct({
  status: Schema.Literal("needs_client_registration"),
  error: Schema.String,
}).annotate({ identifier: "Mcp.Status.NeedsClientRegistration" })

export type Status = typeof Status.Type
export const Status = Schema.Union([Connected, Pending, Disabled, Failed, NeedsAuth, NeedsClientRegistration]).pipe(
  Schema.toTaggedUnion("status"),
)

export interface Server extends Schema.Schema.Type<typeof Server> {}
export const Server = Schema.Struct({
  name: Schema.String,
  status: Status,
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
