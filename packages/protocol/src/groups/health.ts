import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const HealthGroup = HttpApiGroup.make("server.health")
  .add(
    HttpApiEndpoint.get("health.get", "/api/health", {
      success: Schema.Struct({
        healthy: Schema.Literal(true),
        version: Schema.String,
        pid: Schema.Int.check(Schema.isGreaterThan(0)),
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.health.get",
        summary: "Check server health",
        description: "Check whether the API server is ready to accept requests.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "health" }))
