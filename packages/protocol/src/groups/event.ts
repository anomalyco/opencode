import { Event } from "@kancode/schema/event"
import { EventManifest } from "@kancode/schema/event-manifest"
import { Location } from "@kancode/schema/location"
import type { Definition } from "@kancode/schema/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const fields = {
  id: Event.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  durable: Schema.optional(Schema.Struct({ aggregateID: Schema.String, seq: Schema.Int, version: Schema.Int })),
  location: Schema.optional(Location.Ref),
}

const schema = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  Schema.Union([
    ...definitions,
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

const make = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) => {
  const EventSchema = schema(definitions)
  return {
    schema: EventSchema,
    group: HttpApiGroup.make("server.event")
      .add(
        HttpApiEndpoint.get("event.subscribe", "/api/event", {
          success: HttpApiSchema.StreamSse({ data: EventSchema }),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.event.subscribe",
            summary: "Subscribe to events",
            description: "Subscribe to native event payloads for the server.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." })),
  }
}

export const makeEventGroup = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  make(definitions).group

const event = make(EventManifest.ServerDefinitions)
export const EventGroup = event.group
export const KanCodeEvent = event.schema
export type KanCodeEvent = typeof KanCodeEvent.Type
export type KanCodeEventEncoded = typeof KanCodeEvent.Encoded
