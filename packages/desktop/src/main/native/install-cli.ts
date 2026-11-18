import { dialog } from "electron"
import { Cause, Effect, Exit, FiberSet } from "effect"
import { DesktopCli } from "../service/desktop-cli"
import {
  initialInstallCliState,
  transitionInstallCli,
  type InstallCliCommand,
  type InstallCliEvent,
} from "./install-cli-machine"
import { nativeT } from "./translations"

/** Runs the `Install CLI…` machine for the scope's lifetime and returns the menu action. */
export const createCliInstaller = Effect.fn("CliInstaller.make")(function* (desktopCli: DesktopCli.Interface) {
  const fibers = yield* FiberSet.make()
  const run = yield* FiberSet.runtime(fibers)()
  const current = { state: initialInstallCliState() }

  const dispatch = (event: InstallCliEvent) => {
    const next = transitionInstallCli(current.state, event)
    current.state = next.state
    next.commands.forEach(perform)
  }

  const perform = (command: InstallCliCommand) => {
    const attempt = command.attempt

    // `DesktopCli.resolve` dies on failure, so a defect also reaches the user as a failed install. An interrupt only
    // happens on disposal, which the machine already left.
    if (command.type === "run-install")
      return void run(
        desktopCli.install.pipe(
          Effect.exit,
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit))
              return Effect.sync(() => dispatch({ type: "install.succeeded", attempt, path: exit.value }))

            if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void

            const error = Cause.squash(exit.cause)

            return Effect.logError("CLI installation failed", { error }).pipe(
              Effect.andThen(
                Effect.sync(() =>
                  dispatch({
                    type: "install.failed",
                    attempt,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                ),
              ),
            )
          }),
        ),
      )

    const outcome = command.outcome

    return void run(
      Effect.promise(() =>
        dialog.showMessageBox(
          outcome.ok
            ? {
                type: "info",
                message: nativeT("desktop.cli.installed.message", { path: outcome.path }),
                title: nativeT("desktop.cli.installed.title"),
              }
            : {
                type: "error",
                message: nativeT("desktop.cli.failed.message", { error: outcome.error }),
                title: nativeT("desktop.cli.failed.title"),
              },
        ),
      ).pipe(Effect.ensuring(Effect.sync(() => dispatch({ type: "dialog.dismissed", attempt })))),
    )
  }

  yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))

  return () => dispatch({ type: "install.requested" })
})
