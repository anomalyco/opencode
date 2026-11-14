import { Effect, FileSystem, Path } from "effect"

// Keep the current copy and possible stages of an adopted server.
// Windows locks running executables; failed removals retry on the next launch.
export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (
  binary: string,
  options?: { readonly keep?: ReadonlyArray<string>; readonly keepPrefix?: string },
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
      if (keep.has(entry) || (options?.keepPrefix && entry.startsWith(options.keepPrefix))) return
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
