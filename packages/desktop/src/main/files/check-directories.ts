import { Effect, FileSystem } from "effect"

/** Returns the targets that still exist as directories. Targets that fail for reasons other than
 * `NotFound` are kept: permission and transient mount failures do not prove a directory was deleted. */
export const checkDirectories = Effect.fn("DesktopFiles.checkDirectories")(function* (targets: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const checked = yield* Effect.forEach(
    targets,
    (target) =>
      fs.stat(target).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
        Effect.orElseSucceed(() => true),
      ),
    { concurrency: 16 },
  )
  return targets.filter((_, index) => checked[index])
})
