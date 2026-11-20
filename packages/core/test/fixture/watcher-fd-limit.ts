// Subscribes the native watcher to a directory once its process has no file descriptors left, so the inotify backend
// cannot start, the same way it cannot once fs.inotify.max_user_instances is reached. Prints the outcome.
// With `live`, a watch of the same directory is started first, while descriptors remain: the second one then reuses
// Parcel's running backend and existing directory watch, so it needs no new descriptor.
import fs from "node:fs"
import { Effect } from "effect"
import { Watcher } from "@opencode/core/filesystem/watcher"

const input = { type: "directory" as const, target: process.argv[2]!, ignore: [], publish: () => {} }

const subscription = await Effect.gen(function* () {
  const native = yield* Watcher.Native
  // Loading the native binding opens files, so do it while descriptors remain.
  if (!Watcher.hasNativeBinding()) throw new Error("native watcher unavailable")
  if (process.argv[3] === "live" && !(yield* native.subscribe(input))) throw new Error("first watch failed")
  const files = []
  while (true) {
    try {
      files.push(fs.openSync("/dev/null", "r"))
    } catch {
      break
    }
  }
  return yield* native.subscribe(input)
}).pipe(Effect.provide(Watcher.nativeLayer), Effect.runPromise)
console.log(subscription === undefined ? "skipped" : "subscribed")
process.exit(0)
