import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.enable,
  Effect.fn("cli.service.enable")(function* () {
    yield* ServiceConfig.enable()
  }),
)
