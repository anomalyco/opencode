import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"

export const HealthGroup = HttpApiGroup.make("v2.health")
  .add(
    HttpApiEndpoint.get("health", "/api/health", {
      success: Schema.Struct({ healthy: Schema.Literal(true) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.health.get",
        summary: "Check v2 server health",
        description: "Check whether the v2 API server is ready to accept requests.",
      }),
    ),
  )
  .middleware(V2Authorization)
