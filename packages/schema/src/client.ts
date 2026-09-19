export * as Client from "./client.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { NonNegativeInt, optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

const IDSchema = Schema.String.check(Schema.isStartsWith("client_")).pipe(Schema.brand("Client.ID"))

export const ID = IDSchema.pipe(
  statics((schema: typeof IDSchema) => ({ create: (id?: string) => schema.make(id ?? "client_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Kind = Schema.Literals(["tui", "desktop", "web", "other"]).annotate({ identifier: "Client.Kind" })
export type Kind = typeof Kind.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  kind: Kind,
  name: optional(Schema.String),
  sessions: Schema.Array(SessionID),
  focused: Schema.Boolean,
  focusedAt: Schema.Finite,
  updatedAt: Schema.Finite,
  pid: optional(NonNegativeInt),
}).annotate({ identifier: "Client.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  kind: Kind,
  name: optional(Schema.String),
  sessions: optional(Schema.Array(SessionID)),
  focused: optional(Schema.Boolean),
  pid: optional(NonNegativeInt),
}).annotate({ identifier: "Client.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  name: optional(Schema.String),
  sessions: optional(Schema.Array(SessionID)),
  focused: optional(Schema.Boolean),
  pid: optional(NonNegativeInt),
}).annotate({ identifier: "Client.UpdateInput" })

export interface Activate extends Schema.Schema.Type<typeof Activate> {}
export const Activate = Schema.Struct({
  outcome: Schema.Literals(["activated", "none"]),
  client: optional(Info),
}).annotate({ identifier: "Client.Activate" })

const ActivateEvent = ephemeral({
  type: "client.activate",
  schema: {
    clientID: ID,
    sessionID: SessionID,
  },
})

export const Event = {
  Activate: ActivateEvent,
  Definitions: inventory(ActivateEvent),
}
