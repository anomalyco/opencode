export * as ConfigReference from "./reference.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Git extends Schema.Class<Git>("Config.Reference.Git")({
  repository: Schema.String,
  branch: Schema.String.pipe(optional),
  refresh: Schema.DurationFromString.pipe(optional).annotate({
    description: 'Interval between refresh attempts (default: "1 hour")',
  }),
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}) {}

export class Local extends Schema.Class<Local>("Config.Reference.Local")({
  path: Schema.String,
  description: Schema.String.pipe(optional),
  hidden: Schema.Boolean.pipe(optional),
}) {}

export const Entry = Schema.Union([Schema.String, Git, Local])
export type Entry = typeof Entry.Type

export const Info = Schema.Record(Schema.String, Entry)
export type Info = typeof Info.Type
