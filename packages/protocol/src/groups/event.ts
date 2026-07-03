import { Event } from "@opencode-ai/schema/event"
import { EventLog } from "@opencode-ai/schema/event-log"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Location } from "@opencode-ai/schema/location"
import type { Definition } from "@opencode-ai/schema/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

const fields = {
  id: Event.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
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
            description:
              "Subscribe to native event payloads for the server. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed. Consumers that need reliability should combine the changes feed with durable session log reads.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("event.changes", "/api/event/changes", {
          success: HttpApiSchema.StreamSse({ data: EventLog.Change }),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "v2.event.changes",
            summary: "Subscribe to change hints",
            description:
              "Payload-free hint channel: after an event commits, a subscriber eventually receives a hint for that aggregate with seq at or beyond the event, or a sweep-required marker. Hints coalesce to the latest seq per aggregate under backpressure and the stream never fails from overflow. No consumer may derive correctness from receiving a hint; correctness always comes from durable log reads plus the consumer's own checkpoint. A sweep-required marker is emitted first on every (re)subscribe and whenever hint retention is exceeded: treat every aggregate as potentially dirty and recover via bounded sweep plus log reads.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "events", description: "Experimental event stream routes." })),
  }
}

export const makeEventGroup = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  make(definitions).group

const event = make(EventManifest.ServerDefinitions)
export const EventGroup = event.group
export const OpenCodeEvent = event.schema
export type OpenCodeEvent = typeof OpenCodeEvent.Type
export type OpenCodeEventEncoded = typeof OpenCodeEvent.Encoded
