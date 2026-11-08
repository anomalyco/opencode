import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { reportRunError, runNonInteractive } = yield* Effect.promise(() => import("../../run/run"))
    // A one-off run uses the background service when it is already up, but never leaves a new one running.
    const server = yield* ServerConnection.resolve({ autostart: false }).pipe(
      Effect.tapError((error) => Effect.logError("run could not resolve its server", { cause: error })),
      Effect.catch((error) => Effect.sync(() => reportRunError(input, error.message))),
    )
    if (!server) return
    // SIGINT and SIGTERM interrupt this fiber. Interruption waits for the run to cancel its Session and
    // jobs, so the private server and the process shut down only after that.
    yield* Effect.callback<void>((resume) => {
      const controller = new AbortController()
      const done = runNonInteractive(
        {
          server,
          message: [...input.message],
          continue: input.continue,
          session: Option.getOrUndefined(input.session),
          fork: input.fork,
          worktree: Option.getOrUndefined(input.worktree),
          model: Option.getOrUndefined(input.model),
          agent: Option.getOrUndefined(input.agent),
          format: input.format,
          file: [...input.file],
          title: Option.getOrUndefined(input.title),
          archived: input.archived,
          thinking: input.thinking,
          auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
        },
        controller.signal,
      ).then(() => resume(Effect.void))
      return Effect.promise(() => {
        controller.abort()
        return done
      })
    })
  }),
)
