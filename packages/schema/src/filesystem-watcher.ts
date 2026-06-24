export * as FileSystemWatcher from "./filesystem-watcher"

import { Schema } from "effect"
import { define } from "./event"

export const Event = {
  Updated: define({
    type: "file.watcher.updated",
    schema: {
      file: Schema.String,
      event: Schema.Literals(["add", "change", "unlink"]),
    },
  }),
}
