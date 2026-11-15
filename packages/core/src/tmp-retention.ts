export * as TmpRetention from "./tmp-retention.js"

import path from "path"
import { Duration, Effect, Layer, Option, Schedule } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { FileRetention } from "./file-retention.js"

export const RETENTION = Duration.days(7)

/** Deletes files under `directory` untouched for `RETENTION`, then the directories that leaves empty. */
export const cleanup = Effect.fn("TmpRetention.cleanup")(function* (fs: FSUtil.Interface, directory: string) {
  const cutoff = Date.now() - Duration.toMillis(RETENTION)
  const files: string[] = []
  // Directories with no entry added or removed within the retention, judged before this sweep
  // removes anything (which would touch them). A newer one may be about to receive a file.
  const stale: string[] = []
  const walk = (current: string): Effect.Effect<void> =>
    fs.readDirectoryEntries(current).pipe(
      Effect.orElseSucceed(() => []),
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries,
          (entry) => {
            const target = path.join(current, entry.name)
            if (entry.type !== "Directory") return Effect.sync(() => void files.push(target))
            return fs.stat(target).pipe(
              Effect.map((info) => Option.getOrUndefined(info.mtime)),
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap((mtime) => {
                if (mtime && mtime.getTime() > 0 && mtime.getTime() < cutoff) stale.push(target)
                return walk(target)
              }),
            )
          },
          { discard: true },
        ),
      ),
    )
  yield* walk(directory)
  yield* FileRetention.cleanup(fs, files, RETENTION)
  // Children are listed after their parents; remove deepest first so a parent can empty out.
  yield* Effect.forEach(
    stale.reverse(),
    (target) =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => [""]))
        // Node's rm needs `recursive` for any directory; it is empty here.
        if (entries.length === 0) yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore)
      }),
    { discard: true },
  )
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    yield* cleanup(fs, global.tmp).pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped)
  }),
)

export const node = makeGlobalNode({
  name: "tmp-retention",
  layer,
  deps: [FSUtil.node, Global.node],
})
