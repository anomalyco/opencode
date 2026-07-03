export * as FileSystemWatcher from "./filesystem-watcher.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"

const Updated = ephemeral({
  type: "file.watcher.updated",
  schema: {
    file: Schema.String,
    event: Schema.Literals(["add", "change", "unlink"]),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
