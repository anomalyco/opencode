import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi, LocationMiddleware } from "./location"

const Event = Schema.Struct({
  id: EventV2.ID,
  type: Schema.String,
  location: Location.Info.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  version: Schema.Number.pipe(Schema.optional),
  data: Schema.Unknown,
})

export const EventGroup = HttpApiGroup.make("server.event")
  .add(
    HttpApiEndpoint.get("event.subscribe", "/api/event", {
      query: LocationQuery,
      success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.event.subscribe",
          summary: "Subscribe to events",
          description: "Subscribe to native event payloads for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." }))
  .middleware(LocationMiddleware)

export type Event = typeof Event.Type
