// Subscribes the native watcher to a directory once its process has no file descriptors left, so the inotify backend
// cannot start, the same way it cannot once fs.inotify.max_user_instances is reached. Prints the outcome.
import fs from "node:fs"
import { Effect } from "effect"
import { Watcher } from "@opencode/core/filesystem/watcher"

// Loading the native binding opens files, so do it while descriptors remain.
if (!Watcher.hasNativeBinding()) throw new Error("native watcher unavailable")
const files = []
while (true) {
  try {
    files.push(fs.openSync("/dev/null", "r"))
  } catch {
    break
  }
}

const subscription = await Effect.gen(function* () {
  const native = yield* Watcher.Native
  return yield* native.subscribe({ type: "directory", target: process.argv[2]!, ignore: [], publish: () => {} })
}).pipe(Effect.provide(Watcher.nativeLayer), Effect.runPromise)
console.log(subscription === undefined ? "skipped" : "subscribed")
