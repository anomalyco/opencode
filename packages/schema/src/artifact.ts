export * as Artifact from "./artifact.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { ascending } from "./identifier.js"
import { optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

export const ID = Schema.String.check(Schema.isStartingWith("art_")).pipe(
  Schema.brand("Artifact.ID"),
  Schema.annotate({ identifier: "Artifact.ID" }),
  statics((schema) => ({
    create: () => schema.make("art_" + ascending()),
  })),
)
export type ID = typeof ID.Type

export const ProviderID = Schema.Trim.check(Schema.isNonEmpty()).pipe(
  Schema.brand("Artifact.ProviderID"),
  Schema.annotate({ identifier: "Artifact.ProviderID" }),
)
export type ProviderID = typeof ProviderID.Type

export const Capability = Schema.Literals(["static", "server-code", "sqlite", "durable-objects"]).annotate({
  identifier: "Artifact.Capability",
})
export type Capability = typeof Capability.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  capabilities: Schema.Array(Capability),
  default: Schema.Boolean,
}).annotate({ identifier: "Artifact.Provider" })

export interface Time extends Schema.Schema.Type<typeof Time> {}
export const Time = Schema.Struct({
  created: Schema.Finite,
  updated: Schema.Finite,
}).annotate({ identifier: "Artifact.Time" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  provider: ProviderID,
  sessionID: SessionID.pipe(optional),
  title: Schema.String,
  entry: Schema.String,
  url: Schema.String,
  time: Time,
}).annotate({ identifier: "Artifact.Info" })

export interface Content extends Schema.Schema.Type<typeof Content> {}
export const Content = Schema.Struct({
  info: Info,
  files: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "Artifact.Content" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  title: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
  entry: Schema.String.pipe(optional),
  provider: ProviderID.pipe(optional),
  sessionID: SessionID.pipe(optional),
}).annotate({ identifier: "Artifact.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  title: Schema.String.pipe(optional),
  files: Schema.Record(Schema.String, Schema.String),
  entry: Schema.String.pipe(optional),
  sessionID: SessionID.pipe(optional),
}).annotate({ identifier: "Artifact.UpdateInput" })

const Updated = ephemeral({
  type: "artifact.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }
