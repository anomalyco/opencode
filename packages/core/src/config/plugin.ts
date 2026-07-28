export * as ConfigPlugin from "./plugin"

import { Schema } from "effect"

export class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
  package: Schema.String,
  options: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export const Plugin = Schema.Union([Schema.String, Entry])
export type Plugin = typeof Plugin.Type

export const Plugins = Plugin.pipe(Schema.Array)
