import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const ServerStatus = Schema.Struct({
  version: Schema.String,
  // 0 means the runtime has no OS process identity (e.g. workerd).
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  urls: Schema.Array(Schema.String),
}).annotate({ identifier: "ServerStatus" })
export type ServerStatus = typeof ServerStatus.Type

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
  .annotateMerge(OpenApi.annotations({ title: "server" }))
