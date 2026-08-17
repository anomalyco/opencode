import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("cli.service.stop")(function* () {
    const options = yield* ServiceConfig.options()
    yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
    yield* Service.stop(options)
  }),
)
