export * as ConfigToolOutput from "./tool-output.js"

import { Schema } from "effect"
import { PositiveInt } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.ToolOutput")({
  max_lines: PositiveInt.pipe(Schema.optional),
  max_bytes: PositiveInt.pipe(Schema.optional),
}) {}
