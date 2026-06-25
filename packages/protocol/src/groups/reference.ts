import { Location } from "@opencode-ai/schema/location"
import { Reference } from "@opencode-ai/schema/reference"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ReferenceGroup = HttpApiGroup.make("server.reference")
  .add(
    HttpApiEndpoint.get("reference.list", "/api/reference", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Reference.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.reference.list",
          summary: "List references",
          description: "List references available in the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "reference",
      description: "Location-scoped project references.",
    }),
  )
