import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("cli.service.stop")(function* () {
    yield* (yield* Daemon.Service).stop()
  }),
)
