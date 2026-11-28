import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const FlagGroup = HttpApiGroup.make("server.flag")
  .add(
    HttpApiEndpoint.get("experimental.flag.get", "/api/experimental/flag", {
      query: LocationQuery,
      success: Location.response(Schema.Record(Schema.String, Schema.Boolean)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.flag.get",
          summary: "Get feature flags",
          description:
            "Experimental. Return the resolved feature flags the location's clients may act on, keyed by flag name. Flags not listed are off.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "flag",
      description: "Experimental feature flag routes.",
    }),
  )
