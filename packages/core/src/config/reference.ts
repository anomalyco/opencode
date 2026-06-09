export * as ConfigReference from "./reference"

import { Schema } from "effect"

export class Git extends Schema.Class<Git>("ConfigV2.Reference.Git")({
  repository: Schema.String,
  branch: Schema.String.pipe(Schema.optional),
}) {}

export class Local extends Schema.Class<Local>("ConfigV2.Reference.Local")({
  path: Schema.String,
}) {}

export const Entry = Schema.Union([Schema.String, Git, Local])
export type Entry = typeof Entry.Type

export const Info = Schema.Record(Schema.String, Entry)
export type Info = typeof Info.Type
