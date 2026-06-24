import { EventV2 } from "@opencode-ai/core/event"
import { PublicEventManifest } from "@opencode-ai/core/public-event-manifest"
import { Location } from "@opencode-ai/core/location"
import type { Definition } from "@opencode-ai/core/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const fields = {
  id: EventV2.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  durable: Schema.optional(Schema.Struct({ aggregateID: Schema.String, seq: Schema.Int, version: Schema.Int })),
  location: Schema.optional(Location.Ref),
}

const schema = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  Schema.Union([
    ...definitions.map((definition) =>
      Schema.Struct({
        ...fields,
        type: Schema.Literal(definition.type),
        data: definition.data,
      }).annotate({ identifier: `V2Event.${definition.type}` }),
    ),
    ...(definitions.some((definition) => definition.type === "server.connected")
      ? []
      : [
          Schema.Struct({
            ...fields,
            type: Schema.Literal("server.connected"),
            data: Schema.Struct({}),
          }).annotate({ identifier: "V2Event.server.connected" }),
        ]),
  ]).annotate({ identifier: "V2Event" })

export const makeEventGroup = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  HttpApiGroup.make("server.event")
    .add(
      HttpApiEndpoint.get("event.subscribe", "/api/event", {
        success: schema(definitions),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "v2.event.subscribe",
          summary: "Subscribe to events",
          description: "Subscribe to native event payloads for the server.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." }))

const EventSchema = schema(PublicEventManifest.Definitions)

export const EventGroup = HttpApiGroup.make("server.event")
  .add(
    HttpApiEndpoint.get("event.subscribe", "/api/event", {
      success: EventSchema,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.event.subscribe",
        summary: "Subscribe to events",
        description: "Subscribe to native event payloads for the server.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." }))
export type Event = typeof EventSchema.Type
