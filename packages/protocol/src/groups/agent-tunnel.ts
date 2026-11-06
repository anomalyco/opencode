import { AgentTunnel } from "@opencode/schema/agent-tunnel"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { ServiceUnavailableError, SessionNotFoundError } from "../errors.js"

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

/** Replay-to-live boundary marker for the agent tunnel log stream. */
const Synced = Schema.Struct({
  type: Schema.Literal("agent-tunnel.synced"),
  sessionID: Session.ID,
}).annotate({
  identifier: "AgentTunnel.Synced",
  description: "Marker emitted once when the agent tunnel log reaches its captured watermark.",
})

export const ListQuery = Schema.Struct({
  sessionID: Session.ID.annotate({
    description: "Any session of the family: messages sent by or to the family root and its descendants are listed.",
  }),
  after: Schema.NumberFromString.pipe(
    Schema.decodeTo(Event.Seq),
    Schema.optional,
  ).annotate({ description: "Exclusive sequence cursor: only messages with a higher sequence are listed." }),
}).annotate({ identifier: "AgentTunnel.ListQuery" })
export type ListQuery = typeof ListQuery.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const AgentTunnelEndpoints = [
  HttpApiEndpoint.get("agentTunnel.list", "/api/experimental/agent-tunnel", {
    query: ListQuery,
    success: Schema.Struct({ data: Schema.Array(AgentTunnel.Message) }),
    error: [ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.agentTunnel.list",
      summary: "List agent tunnel messages",
      description:
        "List the agent tunnel messages of a session family, ordered by (time.created, sequence). Experimental: may change without compatibility guarantees.",
      transform: (operation) => ({ ...operation, tags: ["experimental"] }),
    }),
  ),
  HttpApiEndpoint.get("agentTunnel.log", "/api/experimental/agent-tunnel/log", {
    query: {
      sessionID: Session.ID.annotate({
        description: "Any session of the family: messages sent by or to the family root and its descendants are replayed.",
      }),
      after: Schema.NumberFromString.pipe(
        Schema.decodeTo(Event.Seq),
        Schema.optional,
      ).annotate({ description: "Exclusive sequence cursor: only messages with a higher sequence are replayed." }),
      follow: BooleanFromString.pipe(Schema.optional).annotate({
        description: "Replay family messages, emit a synced marker, then keep streaming live messages.",
      }),
    },
    success: HttpApiSchema.StreamSse({
      data: Schema.Union([AgentTunnel.Message, Synced]).annotate({ identifier: "AgentTunnel.LogItem" }),
    }),
    error: [ServiceUnavailableError, SessionNotFoundError],
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "experimental.agentTunnel.log",
      summary: "Read the agent tunnel log",
      description:
        "Replay the agent tunnel messages of a session family after an exclusive sequence cursor, emit a one-time synced marker, then continue with live messages when follow=true. Experimental: may change without compatibility guarantees.",
      transform: (operation) => ({ ...operation, tags: ["experimental"] }),
    }),
  ),
] as const
