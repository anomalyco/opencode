import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.unset,
  Effect.fn("cli.service.unset")(function* (input) {
    yield* (yield* Daemon.Service).unset(input.key)
  }),
)
