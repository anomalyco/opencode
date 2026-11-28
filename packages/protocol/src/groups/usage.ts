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
            "Return the OpenCode Go allowance and Console budgets of the OpenCode Console workspace the location is signed in to, or null when it isn't signed in.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("usage.go", "/api/experimental/usage/go", {
      query: LocationQuery,
      success: Location.response(Schema.NullOr(UsageLimits.GoConnection)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.usage.go",
          summary: "Get OpenCode Go connection",
          description:
            "Experimental: may change without compatibility guarantees. Return how OpenCode Go is connected at the location, through the OpenCode account or an API key, with that credential's Go allowance, or null when nothing connects it.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "usage",
      description: "Experimental usage limit routes.",
    }),
  )
