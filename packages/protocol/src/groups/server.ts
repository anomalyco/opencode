import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const ServerGroup = HttpApiGroup.make("server.server")
  .add(
    HttpApiEndpoint.get("server.get", "/api/server", {
      success: Schema.Struct({ urls: Schema.Array(Schema.String) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.server.get",
        summary: "Get server information",
        description: "Return the URLs that can be used to connect to this server.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "server" }))
