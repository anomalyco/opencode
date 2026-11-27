import { Location } from "@opencode/schema/location"
import { UsageLimits } from "@opencode/schema/usage-limits"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const UsageGroup = HttpApiGroup.make("server.usage")
  .add(
    HttpApiEndpoint.get("usage.limits", "/api/experimental/usage/limits", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(UsageLimits.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.limits",
          summary: "Get usage limits",
          description:
            "Experimental: may change without compatibility guarantees. Return subscription allowances and Console budgets for this location, or null when no usage data is available.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "usage",
      description: "Experimental usage limit routes.",
    }),
  )
