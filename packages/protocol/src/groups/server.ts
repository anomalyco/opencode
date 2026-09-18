import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

export const ServerStatus = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  urls: Schema.Array(Schema.String),
}).annotate({ identifier: "ServerStatus" })
export type ServerStatus = typeof ServerStatus.Type

export const ServerPairing = Schema.Struct({
  urls: Schema.Array(Schema.String),
  tailscale: Schema.Struct({
    available: Schema.Boolean,
    urls: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "ServerPairing" })
export type ServerPairing = typeof ServerPairing.Type

export const ServerGroup = HttpApiGroup.make("server.server")
  .add(
    HttpApiEndpoint.get("server.status", "/api/status", {
      success: ServerStatus,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.status",
        summary: "Get server status",
        description: "Return the server identity, connection URLs, and readiness status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("server.pairing.status", "/api/server/pairing", {
      success: ServerPairing,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pairing.status",
        summary: "Get server pairing status",
        description: "Return direct connection URLs and Tailscale Serve availability for this server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("server.pairing.tailscale.enable", "/api/server/pairing/tailscale", {
      success: ServerPairing,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pairing.tailscale.enable",
        summary: "Enable Tailscale pairing",
        description: "Expose this server through Tailscale Serve and return its pairing URLs.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("server.pairing.tailscale.disable", "/api/server/pairing/tailscale", {
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "server.pairing.tailscale.disable",
        summary: "Disable Tailscale pairing",
        description: "Disable the Tailscale Serve listener managed for this server.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
