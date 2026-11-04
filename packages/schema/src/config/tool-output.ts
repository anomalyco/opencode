export * as ConfigToolOutput from "./tool-output.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.ToolOutput")({
  max_lines: PositiveInt.pipe(optional),
  max_bytes: PositiveInt.pipe(optional),
}) {}
