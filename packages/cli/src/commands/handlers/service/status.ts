import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* () {
    const url = yield* (yield* Daemon.Service).status()
    process.stdout.write((url ? `running ${url}` : "stopped") + EOL)
  }),
)
