export * as Credential from "./credential.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ephemeral, inventory } from "./event.js"
import { IntegrationID, IntegrationMethodID } from "./integration-id.js"
import { ascending } from "./identifier.js"
import { NonNegativeInt, statics } from "./schema.js"
import { Form } from "./form.js"

export const ID = Schema.String.pipe(
  Schema.brand("Credential.ID"),
  statics((schema) => ({ create: () => schema.make("cred_" + ascending()) })),
)
export type ID = typeof ID.Type

const Updated = ephemeral({
  type: "credential.updated",
  schema: {},
})
const Switched = ephemeral({
  type: "credential.switched",
  schema: { integrationID: IntegrationID, credentialID: Schema.NullOr(ID) },
})
export const Event = {
  Updated,
  Switched,
  Definitions: inventory(Updated, Switched),
}

export interface OAuth extends Schema.Schema.Type<typeof OAuth> {}
export const OAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  methodID: IntegrationMethodID,
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.OAuth" })

export interface Key extends Schema.Schema.Type<typeof Key> {}
export const Key = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
  configuration: optional(Form.Answer),
}).annotate({ identifier: "Credential.Key" })

/** References a credential source whose secrets and renewal are managed outside the credential store. */
export interface External extends Schema.Schema.Type<typeof External> {}
export const External = Schema.Struct({
  type: Schema.Literal("external"),
  methodID: IntegrationMethodID,
  metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "Credential.External" })

export const Value = Schema.Union([OAuth, Key, External])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Credential.Value" })
export type Value = Schema.Schema.Type<typeof Value>

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  id: ID,
  integrationID: IntegrationID,
  label: Schema.String,
  active: Schema.Boolean,
  value: Value,
}).annotate({ identifier: "Credential.Entry" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  id: optional(ID),
  integrationID: IntegrationID,
  label: optional(Schema.String),
  value: Value,
  activate: optional(Schema.Boolean),
}).annotate({ identifier: "Credential.CreateInput" })
