export * as ConfigPlugin from "./plugin.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
  package: Schema.String,
  options: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}) {}

export const Plugin = Schema.Union([Schema.String, Entry])
export type Plugin = typeof Plugin.Type

export const Plugins = Plugin.pipe(Schema.Array)
