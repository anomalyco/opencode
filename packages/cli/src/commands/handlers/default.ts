import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect } from "effect"
import { Daemon } from "../../services/daemon"

export default Runtime.handler(Commands, () =>
  Effect.gen(function* () {
    const daemon = yield* Daemon.Service
    const transport = yield* daemon.transport()
    const { runTui } = yield* Effect.promise(() => import("../../tui"))
    yield* runTui(transport)
  }),
)
