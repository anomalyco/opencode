export * as ConfigWatcher from "./watcher"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Watcher")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  ignore: Schema.String.pipe(Schema.Array, Schema.optional),
}) {}
