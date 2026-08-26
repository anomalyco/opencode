export * as Plugin from "./plugin.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin") }),
  Schema.Struct({ type: Schema.Literal("package"), package: Schema.String }),
  Schema.Struct({ type: Schema.Literal("local"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sdk") }),
]).annotate({ identifier: "Plugin.Source" })
export type Source = typeof Source.Type

export const Info = Schema.Union([
  Schema.Struct({
    id: ID,
    source: Source,
    status: Schema.Literal("active"),
    tui: Schema.Boolean,
  }),
  Schema.Struct({
    id: ID.pipe(optional),
    source: Source,
    status: Schema.Literal("failed"),
    error: Schema.String,
    tui: Schema.Boolean,
  }),
]).annotate({ identifier: "Plugin.Info" })
export type Info = typeof Info.Type

export interface UpdateInfo extends Schema.Schema.Type<typeof UpdateInfo> {}
export const UpdateInfo = Schema.Struct({
  name: Schema.String,
  source: Source,
  status: Schema.Literals(["not-updateable", "pinned", "up-to-date", "available", "failed"]),
  currentVersion: Schema.String.pipe(optional),
  latestVersion: Schema.String.pipe(optional),
  error: Schema.String.pipe(optional),
}).annotate({ identifier: "Plugin.UpdateInfo" })

export interface UpdateResult extends Schema.Schema.Type<typeof UpdateResult> {}
export const UpdateResult = Schema.Struct({
  name: Schema.String,
  source: Source,
  status: Schema.Literals(["not-updateable", "pinned", "up-to-date", "updated", "failed"]),
  previousVersion: Schema.String.pipe(optional),
  version: Schema.String.pipe(optional),
  error: Schema.String.pipe(optional),
}).annotate({ identifier: "Plugin.UpdateResult" })

const Added = ephemeral({
  type: "plugin.added",
  schema: { id: ID },
})
const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Added, Updated, Definitions: inventory(Added, Updated) }
