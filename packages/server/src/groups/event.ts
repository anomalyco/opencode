import { EventV2 } from "@opencode-ai/core/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const Event = Schema.Union([
  ...EventV2.definitions().map((definition) =>
    Schema.Struct({
      ...EventV2.Payload.fields,
      type: Schema.Literal(definition.type),
      data: definition.data,
    }).annotate({ identifier: `V2Event.${definition.type}` }),
  ),
  Schema.Struct({
    ...EventV2.Payload.fields,
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
