import { Formatter } from "@opencode/schema/formatter"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const FormatterGroup = HttpApiGroup.make("server.formatter")
  .add(
    HttpApiEndpoint.get("formatter.status", "/api/formatter", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Formatter.Status)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "formatter.status",
          summary: "Get formatter status",
          description: "Retrieve configured formatters and whether each is enabled for the location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "formatter",
      description: "Formatter routes.",
    }),
  )
