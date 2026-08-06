export * as ConfigFormatter from "./formatter.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Entry extends Schema.Class<Entry>("Config.Formatter.Entry")({
  disabled: Schema.Boolean.pipe(optional),
  command: Schema.String.pipe(Schema.Array, optional),
  environment: Schema.Record(Schema.String, Schema.String).pipe(optional),
  extensions: Schema.String.pipe(Schema.Array, optional),
}) {}

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
