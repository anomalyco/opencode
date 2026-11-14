import { SessionMessage } from "./session-message.js"
import { Location } from "./location.js"
import { Schema, Struct } from "effect"

// Keyed by message type so a new message type cannot be left out of the filter.
const MessageTypes = {
  "agent-switched": true,
  "model-switched": true,
  "location-switched": true,
  user: true,
  synthetic: true,
  system: true,
  skill: true,
  shell: true,
  assistant: true,
  compaction: true,
  idle: true,
} satisfies Record<SessionMessage.Type, true>

export const SessionMessagesQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ).annotate({
    description: "Maximum number of messages to return. When omitted, the endpoint returns its default page size.",
  }),
  order: Schema.optional(Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")])).annotate({
    description: "Message order for the first page. Use desc for newest first or asc for oldest first.",
  }),
  cursor: Schema.optional(
    Schema.String.annotate({
      description:
        "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order.",
    }),
  ),
  type: Schema.optional(Schema.Literals(Object.keys(MessageTypes) as ReadonlyArray<SessionMessage.Type>)).annotate({
    description:
      "Filter by message type before pagination. When omitted, all message types are returned. Pass the same type when following cursors.",
  }),
}).annotate({ identifier: "SessionMessagesQuery" })

export interface SessionMessagesQuery extends Schema.Schema.Type<typeof SessionMessagesQuery> {}

export const PublicLocationSwitched = Schema.Struct({
  ...Struct.omit(SessionMessage.LocationSwitched.fields, ["location", "previous"]),
  location: Location.PublicRef,
  previous: Schema.Struct({
    location: Location.PublicRef,
    projectID: SessionMessage.LocationSwitched.fields.projectID,
    subpath: SessionMessage.LocationSwitched.fields.subpath,
  }).pipe(Schema.optional),
}).annotate({ identifier: "Session.Message.LocationSwitched" })
