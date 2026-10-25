export * as ConfigWatcher from "./watcher.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Watcher")({
  ignore: Schema.String.pipe(Schema.Array, optional),
}) {}
