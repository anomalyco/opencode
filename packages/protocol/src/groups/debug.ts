import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const DebugGroup = HttpApiGroup.make("server.debug")
  .add(
    HttpApiEndpoint.get("debug.location", "/api/debug/location", {
      success: Schema.Array(Location.Ref),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.debug.location",
        summary: "List loaded locations",
        description: "List locations currently loaded by the server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("debug.location.evict", "/api/debug/location", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.debug.location.evict",
          summary: "Evict a loaded location",
          description: "Dispose the requested location's cached services so its next use boots them fresh.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "debug" }))
