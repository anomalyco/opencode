import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.start,
  Effect.fn("cli.service.start")(function* () {
    process.stdout.write((yield* (yield* Daemon.Service).start()) + EOL)
  }),
)
