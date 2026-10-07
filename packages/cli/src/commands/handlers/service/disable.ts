import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.service.commands.disable,
  Effect.fn("cli.service.disable")(function* () {
    yield* ServerConnection.shutdownPersistentPty(yield* ServiceConfig.options()).pipe(Effect.ignore)
    yield* ServiceConfig.disable()
  }),
)
