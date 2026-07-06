import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

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
  .annotateMerge(OpenApi.annotations({ title: "debug" }))
