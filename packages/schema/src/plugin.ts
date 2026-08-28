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
    revision: optional(Schema.String),
    status: Schema.Literal("active"),
    tui: Schema.Boolean,
  }),
  Schema.Struct({
    id: ID.pipe(optional),
    source: Source,
    revision: optional(Schema.String),
    status: Schema.Literal("failed"),
    error: Schema.String,
    tui: Schema.Boolean,
  }),
]).annotate({ identifier: "Plugin.Info" })
export type Info = typeof Info.Type

export const PackageStatus = Schema.Struct({
  installed: optional(Schema.String),
  available: optional(Schema.String),
  mutable: Schema.Boolean,
}).annotate({ identifier: "Plugin.PackageStatus" })
export interface PackageStatus extends Schema.Schema.Type<typeof PackageStatus> {}

export class CheckError extends Schema.TaggedError<CheckError>()(
  "PluginCheckError",
  { message: Schema.String },
  { identifier: "PluginCheckError" },
) {}

const Added = ephemeral({
  type: "plugin.added",
  schema: { id: ID },
})
const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Added, Updated, Definitions: inventory(Added, Updated) }
