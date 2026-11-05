export * as FileRetention from "./file-retention.js"

import { Duration, Effect, Option } from "effect"
import { FSUtil } from "@opencode/util/fs-util"

export const cleanup = Effect.fn("FileRetention.cleanup")(function* (
  fs: FSUtil.Interface,
  files: ReadonlyArray<string>,
  retention: Duration.Input,
  // Runs before an expired file is removed.
  beforeRemove?: (file: string) => Effect.Effect<void>,
) {
  const cutoff = Date.now() - Duration.toMillis(retention)
  yield* Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => undefined))
        const mtime = info && Option.getOrUndefined(info.mtime)
        if (!mtime || mtime.getTime() >= cutoff) return
        if (beforeRemove) yield* beforeRemove(file)
        yield* fs.remove(file).pipe(Effect.ignore)
      }),
    { concurrency: 8, discard: true },
  )
})
