import { Event } from "@opencode-ai/schema/event"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Location } from "@opencode-ai/schema/location"
import type { Definition } from "@opencode-ai/schema/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const fields = {
  id: Event.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  durable: Schema.optional(Schema.Struct({ aggregateID: Schema.String, seq: Schema.Int, version: Schema.Int })),
  location: Schema.optional(Location.Ref),
}

const schema = (definitions: ReadonlyArray<Definition>) =>
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

const make = (definitions: ReadonlyArray<Definition>) => {
  const EventSchema = schema(definitions)
  return {
    schema: EventSchema,
    group: HttpApiGroup.make("server.event")
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
      .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream route." })),
  }
}

export const makeEventGroup = (definitions: ReadonlyArray<Definition>) => make(definitions).group

const event = make(EventManifest.ServerDefinitions)
export const EventGroup = event.group
export type Event = typeof event.schema.Type
