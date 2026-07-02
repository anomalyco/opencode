import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect, Option } from "effect"
import { Daemon } from "../../services/daemon"
import { Standalone } from "../../services/standalone"
import { Updater } from "../../services/updater"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const directory = Option.getOrUndefined(input.directory)
    if (directory !== undefined) process.chdir(directory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const daemon = yield* Daemon.Service
    const transport = yield* (input.standalone ? Standalone.transport() : daemon.transport())
    const { runTui } = yield* Effect.promise(() => import("../../tui"))
    yield* runTui(
      transport,
      { continue: input.continue, sessionID: Option.getOrUndefined(input.session) },
      input.standalone
        ? undefined
        : async () => {
            await Effect.runPromise(daemon.stop())
            return Effect.runPromise(daemon.transport())
          },
    )
  }),
)
