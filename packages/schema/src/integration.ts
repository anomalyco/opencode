export * as Integration from "./integration.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ephemeral, inventory } from "./event.js"
import { Connection } from "./connection.js"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"
import { IntegrationID, IntegrationMethodID } from "./integration-id.js"
import { Form } from "./form.js"

export const ID = IntegrationID
export type ID = typeof ID.Type

export const MethodID = IntegrationMethodID
export type MethodID = typeof MethodID.Type

export interface OAuthMethod extends Schema.Schema.Type<typeof OAuthMethod> {}
export const OAuthMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("oauth"),
  label: Schema.String,
  form: optional(Form.Fields),
}).annotate({ identifier: "Integration.OAuthMethod" })

export interface CommandMethod extends Schema.Schema.Type<typeof CommandMethod> {}
export const CommandMethod = Schema.Struct({
  id: MethodID,
  type: Schema.Literal("command"),
  label: Schema.String,
  command: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.CommandMethod" })

export interface KeyMethod extends Schema.Schema.Type<typeof KeyMethod> {}
export const KeyMethod = Schema.Struct({
  type: Schema.Literal("key"),
  label: optional(Schema.String),
  form: optional(Form.Fields),
}).annotate({ identifier: "Integration.KeyMethod" })

export interface EnvMethod extends Schema.Schema.Type<typeof EnvMethod> {}
export const EnvMethod = Schema.Struct({
  type: Schema.Literal("env"),
  names: Schema.Array(Schema.String),
}).annotate({ identifier: "Integration.EnvMethod" })

export const Method = Schema.Union([OAuthMethod, CommandMethod, KeyMethod, EnvMethod])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Integration.Method" })
export type Method = typeof Method.Type

const Updated = ephemeral({
  type: "integration.updated",
  schema: {},
})
const ConnectionUpdated = ephemeral({
  type: "integration.connection.updated",
  schema: { integrationID: ID },
})
export const Event = { Updated, ConnectionUpdated, Definitions: inventory(Updated, ConnectionUpdated) }

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  id: ID,
  name: Schema.String,
}).annotate({ identifier: "Integration.Ref" })

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  methods: Schema.Array(Method),
  connections: Schema.Array(Connection.Info),
}).annotate({ identifier: "Integration.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const AttemptID = Schema.String.pipe(
  Schema.brand("Integration.AttemptID"),
  statics((schema) => ({ create: () => schema.make("con_" + ascending()) })),
)
export type AttemptID = typeof AttemptID.Type

const AttemptTime = Schema.Struct({
  created: Schema.Number,
  expires: Schema.Number,
})

export class Attempt extends Schema.Class<Attempt>("Integration.Attempt")({
  attemptID: AttemptID,
  url: Schema.String,
  instructions: Schema.String,
  mode: Schema.Literals(["auto", "code"]),
  time: AttemptTime,
}) {}

export const AttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("complete"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("expired"), time: AttemptTime }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Integration.AttemptStatus" })
export type AttemptStatus = typeof AttemptStatus.Type

export interface CommandAttempt extends Schema.Schema.Type<typeof CommandAttempt> {}
export const CommandAttempt = Schema.Struct({
  attemptID: AttemptID,
  time: AttemptTime,
}).annotate({ identifier: "Integration.CommandAttempt" })

export const CommandAttemptStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending"), message: optional(Schema.String), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("complete"), time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String, time: AttemptTime }),
  Schema.Struct({ status: Schema.Literal("expired"), time: AttemptTime }),
])
  .pipe(Schema.toTaggedUnion("status"))
  .annotate({ identifier: "Integration.CommandAttemptStatus" })
export type CommandAttemptStatus = typeof CommandAttemptStatus.Type
