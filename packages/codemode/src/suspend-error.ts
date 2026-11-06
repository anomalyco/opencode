import { Schema } from "effect"

/**
 * A suspend that failed, leaving the run running: `running` names each host call that blocked it by its key and its
 * path (`tools.x.y`, `search`, or an extension function's path such as `fetch`). Empty when the state couldn't be
 * saved or was too large.
 */
export class SuspendError extends Schema.TaggedError<SuspendError>()("SuspendError", {
  message: Schema.String,
  running: Schema.Array(Schema.Struct({ key: Schema.String, path: Schema.String })),
}) {}
