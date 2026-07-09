import { Effect } from "effect"
import { initLogging } from "./logging"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"

type StartupLogger = Pick<ReturnType<typeof initLogging>, "log" | "warn">

export function runStartupTasks(logger: StartupLogger, userDataPath: string, testOnboarding: boolean) {
  return Effect.gen(function* () {
    if (!testOnboarding) migrate()
    yield* Effect.promise(() => cleanupStoreFiles(userDataPath)).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          if (result.deleted.length === 0) return
          logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("failed to clean scoped store files", error)
        }),
      ),
    )
  })
}
