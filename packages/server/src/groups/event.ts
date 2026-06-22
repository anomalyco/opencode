import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const fields = {
  id: EventV2.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  durable: Schema.optional(Schema.Struct({ aggregateID: Schema.String, seq: Schema.Int, version: Schema.Int })),
  location: Schema.optional(Location.Ref),
}

const Event = Schema.Union([
  ...EventV2.definitions().map((definition) =>
    Schema.Struct({
      ...fields,
      type: Schema.Literal(definition.type),
      data: definition.data as Schema.Struct<{}>,
    }).annotate({ identifier: `V2Event.${definition.type}` }),
  ),
  Schema.Struct({
    ...fields,
    type: Schema.Literal("server.connected"),
    data: Schema.Struct({}),
  }).annotate({ identifier: "V2Event.server.connected" }),
]).annotate({ identifier: "V2Event" })

export const EventGroup = HttpApiGroup.make("server.event")
  .add(
    HttpApiEndpoint.get("event.subscribe", "/api/event", {
      success: Event,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.event.subscribe",
        summary: "Subscribe to events",
        description: "Subscribe to native event payloads for the server.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." }))

export type Event = typeof Event.Type
