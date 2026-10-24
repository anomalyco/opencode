import { Effect } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Watcher } from "../../src/filesystem/watcher"

const directory = process.argv[2]
const type = process.argv[3] === "file" ? "file" : "entries"
const native = await Effect.runPromise(Watcher.Native.pipe(Effect.provide(Watcher.nativeLayer)))
await Effect.runPromise(
  native.subscribe({
    type,
    target: type === "file" ? path.join(directory, "AGENTS.md") : directory,
    names: ["AGENTS.md"],
    ignore: [],
    publish: () => {},
  }),
)
console.log("watching")
await fs.rmdir(directory)
console.log("removed")
// An open native watcher keeps the child alive; do not make the deadline do so.
setTimeout(() => process.exit(1), 1000).unref()
