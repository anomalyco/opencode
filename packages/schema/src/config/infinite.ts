export * as ConfigInfinite from "./infinite.js"

import { Schema } from "effect"
import { PositiveInt, optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Infinite")({
  maxIterations: PositiveInt.pipe(optional).annotate({
    description: "Maximum auto-continue iterations before stopping",
  }),
  maxHours: PositiveInt.pipe(optional).annotate({
    description: "Maximum wall-clock hours before stopping",
  }),
  sentinel: Schema.String.pipe(optional).annotate({
    description: "Completion marker the agent emits when the task is fully complete",
  }),
  todoDetection: Schema.Boolean.pipe(optional).annotate({
    description: "Stop when all todos are completed or cancelled",
  }),
}) {}
