import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.set,
  Effect.fn("cli.service.set")(function* (input) {
    yield* (yield* Daemon.Service).set(input.key, input.value)
  }),
)
