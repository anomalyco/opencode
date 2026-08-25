export * as Group from "./group.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { Pty } from "./pty.js"
import { statics } from "./schema.js"
import { Session } from "./session.js"

const IDSchema = Schema.String.check(Schema.isStartsWith("grp_")).pipe(Schema.brand("GroupID"))

export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => ({ create: () => schema.make("grp_" + ascending()) })),
)
export type ID = typeof ID.Type

export const SessionItem = Schema.Struct({
  type: Schema.tag("session"),
  id: Session.ID,
})
export interface SessionItem extends Schema.Schema.Type<typeof SessionItem> {}

export const TerminalItem = Schema.Struct({
  type: Schema.tag("terminal"),
  id: Pty.ID,
})
export interface TerminalItem extends Schema.Schema.Type<typeof TerminalItem> {}

export const Item = Schema.Union([SessionItem, TerminalItem]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Group.Item" }),
)
export type Item = typeof Item.Type

export const Info = Schema.Struct({
  id: ID,
  items: Schema.Array(Item),
}).annotate({ identifier: "Group.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const ItemAdded = ephemeral({ type: "group.item.added", schema: { groupID: ID, item: Item } })
const ItemRemoved = ephemeral({ type: "group.item.removed", schema: { groupID: ID, item: Item } })
export const Event = { ItemAdded, ItemRemoved, Definitions: inventory(ItemAdded, ItemRemoved) }
