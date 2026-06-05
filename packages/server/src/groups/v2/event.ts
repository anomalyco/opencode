import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { V2Authorization } from "../../middleware/authorization"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"

const Event = Schema.Struct({
  id: EventV2.ID,
  type: Schema.String,
  location: Location.Info.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  version: Schema.Number.pipe(Schema.optional),
  data: Schema.Unknown,
})

export const EventGroup = HttpApiGroup.make("v2.event")
  .add(
    HttpApiEndpoint.get("events", "/api/event", {
      query: LocationQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.event.subscribe",
          summary: "Subscribe to v2 events",
          description: "Subscribe to native EventV2 payloads for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 events", description: "Experimental v2 event stream route." }))
  .middleware(V2LocationMiddleware)
  .middleware(V2Authorization)

export type Event = typeof Event.Type
