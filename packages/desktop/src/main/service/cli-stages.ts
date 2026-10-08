import { Effect, FileSystem, Path } from "effect"

// Each version stages its own copy of the CLI, and only the current one is ever started again: a
// downgrade stages its copy anew. Windows refuses to delete an executable that has not exited yet,
// so a failed removal is logged and retried on the next launch.
export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const current = path.dirname(binary)
  const root = path.dirname(current)
  const entries = yield* fs.readDirectory(root)
  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const target = path.join(root, entry)

      if (target === current) return
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => undefined))

      if (stat?.type !== "Directory") return
      yield* fs
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })))
    }),
    { concurrency: "unbounded" },
  )
})
