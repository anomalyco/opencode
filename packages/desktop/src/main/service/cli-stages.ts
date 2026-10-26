import { Effect, FileSystem, Path } from "effect"

// Each version and architecture stages its own copy of the CLI, and only the current one (plus any adopted
// beta server still running) is kept: a downgrade stages its copy anew. Windows refuses to delete an executable
// that has not exited yet, so a failed removal is logged and retried on the next launch.
export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (
  binary: string,
  options?: { readonly keep?: ReadonlyArray<string> },
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const current = path.dirname(binary)
  const root = path.dirname(current)
  const keep = new Set([path.basename(current), ...(options?.keep ?? [])])
  const entries = yield* fs.readDirectory(root)
  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      if (keep.has(entry)) return
      const target = path.join(root, entry)
      const stat = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => undefined))

      if (stat?.type !== "Directory") return
      yield* fs
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })))
    }),
    { concurrency: "unbounded" },
  )
})
