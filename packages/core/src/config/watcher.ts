export * as ConfigWatcher from "./watcher"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Watcher")({
  ignore: Schema.String.pipe(Schema.Array, Schema.optional),
}) {}
