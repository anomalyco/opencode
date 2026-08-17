export * as SessionInbox from "./session-inbox.js"

import { Schema } from "effect"
import { Location } from "./location.js"
import { Project } from "./project.js"
import { Prompt } from "./prompt.js"
import { DateTimeUtcFromMillis, optional, RelativePath } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"

export const Delivery = Schema.Literals(["steer", "queue"]).annotate({ identifier: "Session.Inbox.Delivery" })
export type Delivery = typeof Delivery.Type

export interface UserPayload extends Schema.Schema.Type<typeof UserPayload> {}
export const UserPayload = Schema.Struct({
  ...Prompt.fields,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "Session.Inbox.UserPayload" })

export interface SyntheticPayload extends Schema.Schema.Type<typeof SyntheticPayload> {}
export const SyntheticPayload = Schema.Struct({
  text: Schema.String,
  description: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}).annotate({ identifier: "Session.Inbox.SyntheticPayload" })

export interface CompactionPayload extends Schema.Schema.Type<typeof CompactionPayload> {}
export const CompactionPayload = Schema.Struct({}).annotate({ identifier: "Session.Inbox.CompactionPayload" })

export interface MovePayload extends Schema.Schema.Type<typeof MovePayload> {}
export const MovePayload = Schema.Struct({
  location: Location.Ref,
  projectID: Project.ID,
  subpath: RelativePath.pipe(optional),
}).annotate({ identifier: "Session.Inbox.MovePayload" })

const UserItem = Schema.Struct({ type: Schema.tag("user"), payload: UserPayload, delivery: Delivery })
const SyntheticItem = Schema.Struct({ type: Schema.tag("synthetic"), payload: SyntheticPayload, delivery: Delivery })
const CompactionItem = Schema.Struct({
  type: Schema.tag("compaction"),
  payload: CompactionPayload,
  delivery: Delivery,
})
const MoveItem = Schema.Struct({ type: Schema.tag("move"), payload: MovePayload, delivery: Delivery })

export const Item = Schema.Union([UserItem, SyntheticItem, CompactionItem, MoveItem]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Session.Inbox.Item" }),
)
export type Item = typeof Item.Type

const Enqueued = {
  id: SessionMessage.ID,
  sessionID: SessionID,
  timeCreated: DateTimeUtcFromMillis,
}

export interface User extends Schema.Schema.Type<typeof User> {}
export const User = Schema.Struct({ ...Enqueued, ...UserItem.fields }).annotate({ identifier: "Session.Inbox.User" })

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({ ...Enqueued, ...SyntheticItem.fields }).annotate({
  identifier: "Session.Inbox.Synthetic",
})

export interface Compaction extends Schema.Schema.Type<typeof Compaction> {}
export const Compaction = Schema.Struct({ ...Enqueued, ...CompactionItem.fields }).annotate({
  identifier: "Session.Inbox.Compaction",
})

export interface Move extends Schema.Schema.Type<typeof Move> {}
export const Move = Schema.Struct({ ...Enqueued, ...MoveItem.fields }).annotate({ identifier: "Session.Inbox.Move" })

export const Info = Schema.Union([User, Synthetic, Compaction, Move]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Session.Inbox.Info" }),
)
export type Info = typeof Info.Type
