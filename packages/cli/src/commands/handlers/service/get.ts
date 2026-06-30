import { EOL } from "os"
import { Option } from "effect"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.get,
  Effect.fn("cli.service.get")(function* (input) {
    const daemon = yield* Daemon.Service
    process.stdout.write((yield* daemon.get(Option.getOrUndefined(input.key))) + EOL)
  }),
)
