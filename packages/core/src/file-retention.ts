export * as FileRetention from "./file-retention.js"

import { Duration, Effect, Option } from "effect"
import { FSUtil } from "@opencode/util/fs-util"

export const cleanup = Effect.fn("FileRetention.cleanup")(function* (
  fs: FSUtil.Interface,
  files: ReadonlyArray<string>,
  retention: Duration.Input,
) {
  const cutoff = Date.now() - Duration.toMillis(retention)
  yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => undefined))
        const mtime = info && Option.getOrUndefined(info.mtime)
        const modified = mtime?.getTime()
        // workerd reports mtime as the unix epoch for every file, including output
        // that was just written. A non-positive mtime is not an age.
        if (modified === undefined || modified <= 0 || modified >= cutoff) return
        yield* fs.remove(file).pipe(Effect.ignore)
      }),
    { concurrency: 8, discard: true },
  )
})
