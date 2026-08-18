import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export namespace ServiceStatus {
  export const Health = Schema.Struct({
    healthy: Schema.Literal(true),
    version: Schema.String,
    // 0 means the runtime has no OS process identity (e.g. workerd).
    pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }).annotate({ identifier: "ServiceHealth" })
  export type Health = typeof Health.Type
}

export const HealthGroup = HttpApiGroup.make("server.health")
  .add(
    HttpApiEndpoint.get("health.get", "/api/health", {
      success: ServiceStatus.Health,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.health.get",
        summary: "Check server health",
        description: "Report the owning server process and its application status.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "health" }))
