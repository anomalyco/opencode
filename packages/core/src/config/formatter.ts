export * as ConfigFormatter from "./formatter"

import { Schema } from "effect"

export class Entry extends Schema.Class<Entry>("ConfigV2.Formatter.Entry")({
  disabled: Schema.Boolean.pipe(Schema.optional),
  command: Schema.String.pipe(Schema.Array, Schema.optional),
  environment: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  extensions: Schema.String.pipe(Schema.Array, Schema.optional),
}) {}

export const Info = Schema.Union([Schema.Boolean, Schema.Record(Schema.String, Entry)])
