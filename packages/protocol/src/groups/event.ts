import { Event } from "@opencode/schema/event"
import { EventManifest } from "@opencode/schema/event-manifest"
import { Location } from "@opencode/schema/location"
import { Session } from "@opencode/schema/session"
import type { Definition } from "@opencode/schema/event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { EventConnectionNotFoundError } from "../errors.js"

const fields = {
  id: Event.ID,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  location: Schema.optional(Location.PublicRef),
}

const rpcEvent = Schema.Struct({
  id: Event.ID,
  created: Schema.Finite,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  type: Schema.TemplateLiteral(["rpc.", Schema.String]),
  location: Location.PublicRef,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "V2Event.rpc" })

export const EventDetailMode = Schema.Literals(["all", "subscribed"]).annotate({
  identifier: "EventDetailMode",
})
export type EventDetailMode = typeof EventDetailMode.Type

export const EventExperimentalQuery = Schema.Struct({
  detail: Schema.optional(EventDetailMode).annotate({
    description:
      "When set to subscribed, high-volume session detail events are delivered only for sessions registered on this connection.",
  }),
}).annotate({ identifier: "EventExperimentalQuery" })

export const EventSessionsPayload = Schema.Struct({
  sessions: Schema.Array(Session.ID),
}).annotate({ identifier: "EventSessionsPayload" })

const schema = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  Schema.Union([
    ...definitions,
    rpcEvent,
    ...(definitions.some((definition) => definition.type === "server.connected")
      ? []
      : [
          Schema.Struct({
            ...fields,
            type: Schema.Literal("server.connected"),
            data: Schema.Struct({
              connection: Schema.optional(Schema.String),
            }),
          }).annotate({ identifier: "V2Event.server.connected" }),
        ]),
  ]).annotate({ identifier: "V2Event" })

const query = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  Schema.Struct({
    types: Schema.optional(
      Schema.ArrayEnsure(
        Schema.Union([
          Schema.Literals(
            definitions.map((definition) => definition.type) as ReadonlyArray<Definitions[number]["type"]>,
          ),
          rpcEvent.fields.type,
        ]),
      ),
    ).annotate({
      description:
        "Only send events of these types, plus the initial server.connected event. When omitted, all events are sent.",
    }),
  }).annotate({ identifier: "EventSubscribeQuery" })

const make = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) => {
  const EventSchema = schema(definitions)
  return {
    schema: EventSchema,
    group: HttpApiGroup.make("server.event")
      .add(
        HttpApiEndpoint.get("event.subscribe", "/api/event", {
          query: query(definitions),
          success: HttpApiSchema.StreamSse({ data: EventSchema }),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "event.subscribe",
            summary: "Subscribe to events",
            description:
              "Subscribe to native events and plugin RPC events across all server locations. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("event.experimental.subscribe", "/api/experimental/event", {
          query: EventExperimentalQuery,
          success: HttpApiSchema.StreamSse({ data: EventSchema }),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "event.experimental.subscribe",
            summary: "Subscribe to events with per-connection session detail filtering",
            description:
              "Experimental event stream whose server.connected frame includes a connection ID for managing subscribed sessions.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.put("event.experimental.sessions", "/api/experimental/event/:connection/sessions", {
          params: { connection: Schema.String },
          payload: EventSessionsPayload,
          success: HttpApiSchema.NoContent,
          error: [EventConnectionNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "event.experimental.sessions",
            summary: "Replace subscribed sessions for an event stream connection",
            description:
              "Replace the set of session IDs whose detail events are delivered to the specified experimental event stream connection.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "event", description: "Experimental event stream routes." })),
  }
}

export const makeEventGroup = <const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) =>
  make(definitions).group

const event = make(EventManifest.ServerDefinitions)
export const EventGroup = event.group
export const OpenCodeEvent = event.schema
export type OpenCodeEvent = typeof OpenCodeEvent.Type
export type OpenCodeEventEncoded = typeof OpenCodeEvent.Encoded
export const isOpenCodeEvent = (event: { readonly type: string }): event is OpenCodeEvent =>
  event.type === "server.connected" || EventManifest.isServer(event) || event.type.startsWith("rpc.")
