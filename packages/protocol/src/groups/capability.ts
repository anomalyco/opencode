import { Capability } from "@opencode-ai/schema/capability"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const CapabilityGroup = HttpApiGroup.make("server.capability")
  .add(
    HttpApiEndpoint.get("capability.list", "/api/capability", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Capability.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.capability.list",
          summary: "List capabilities",
          description: "List manageable tools and MCP capabilities with their effective preference state.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("capability.update", "/api/capability", {
      query: LocationQuery,
      payload: Capability.Update,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.capability.update",
          summary: "Update capability preference",
          description: "Set or inherit the global preference for one capability.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "capability" }))
