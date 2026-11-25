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

export const Capability = Schema.Literals([
  "static",
  "spa",
  "server-code",
  "sqlite",
  "kv",
  "blob",
  "cron",
  "durable-objects",
]).annotate({
  identifier: "Artifact.Capability",
})
export type Capability = typeof Capability.Type

/** Who can open an artifact: people who reach this server, the provider's signed-in members, or anyone. */
export const Visibility = Schema.Literals(["local", "private", "public"]).annotate({
  identifier: "Artifact.Visibility",
})
export type Visibility = typeof Visibility.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: ProviderID,
  name: Schema.String,
  capabilities: Schema.Array(Capability),
  audiences: Schema.Array(Visibility),
  /** The visibility a new artifact gets when its create names none. */
  defaultAudience: Visibility,
  default: Schema.Boolean,
}).annotate({ identifier: "Artifact.Provider" })

export interface Binding extends Schema.Schema.Type<typeof Binding> {}
export const Binding = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["sqlite", "kv", "blob"]),
  /** Folders of SQL files applied in name order before the server code deploys. */
  migrations: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Artifact.Binding" })

export interface Cron extends Schema.Schema.Type<typeof Cron> {}
export const Cron = Schema.Struct({
  schedule: Schema.String,
  path: Schema.String.pipe(optional),
}).annotate({ identifier: "Artifact.Cron" })

/** What an artifact deploys, from its `artifact.json`. Without one, every file is a public static asset. */
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const Manifest = Schema.Struct({
  /** The folder served as public files. */
  assets: Schema.String.pipe(optional),
  /** Serves `index.html` for paths that match no file. */
  spa: Schema.Boolean,
  /** The server bundle's path. */
  server: Schema.String.pipe(optional),
  bindings: Schema.Array(Binding),
  crons: Schema.Array(Cron),
}).annotate({ identifier: "Artifact.Manifest" })

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
  /** Unknown for an artifact published before providers declared their audiences. */
  visibility: Visibility.pipe(optional),
  time: Time,
}).annotate({ identifier: "Artifact.Info" })

export interface Content extends Schema.Schema.Type<typeof Content> {}
export const Content = Schema.Struct({
  info: Info,
  /** UTF-8 text files up to 64 KiB each and 256 KiB in all, by path. */
  files: Schema.Record(Schema.String, Schema.String),
  /** The byte size of each file left out of `files`: binary, or past those limits. */
  omitted: Schema.Record(Schema.String, Schema.Finite),
  /** `live` from the provider, or `snapshot` from the copy saved when it was last published. */
  source: Schema.Literals(["live", "snapshot"]),
}).annotate({ identifier: "Artifact.Content" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  title: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
  entry: Schema.String.pipe(optional),
  provider: ProviderID.pipe(optional),
  /** Defaults to the provider's default audience. Updates keep it. */
  visibility: Visibility.pipe(optional),
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
