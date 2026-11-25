import { Location } from "@opencode/schema/location"
import { SessionAttention } from "@opencode/schema/session-attention"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const AttentionGroup = HttpApiGroup.make("server.attention")
  .add(
    HttpApiEndpoint.get("attention.list", "/api/experimental/attention", {
      query: LocationQuery,
      success: Location.response(Schema.Array(SessionAttention.Entry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.attention.list",
          summary: "List session attention",
          description:
            "List what Sessions in a location need from a person: pending permission requests, pending forms such as questions, and attention plugins set after a response finished. Experimental: may change without compatibility guarantees.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "attention",
      description: "Experimental session attention routes.",
    }),
  )
