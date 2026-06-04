import { AgentV2 } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

export const AgentGroup = HttpApiGroup.make("v2.agent")
  .add(
    HttpApiEndpoint.get("agents", "/api/agent", {
      query: LocationQuery,
      success: Location.response(Schema.Array(AgentV2.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.list",
          summary: "List v2 agents",
          description: "Retrieve currently registered v2 agents.",
        }),
      ),
  )
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)
