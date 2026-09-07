import { Effect } from "effect"
import { Commands } from "../../../commands"
import { Runtime } from "../../../../framework/runtime"
import { ServiceConfig } from "../../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.url.commands.remove,
  Effect.fn("cli.service.url.remove")(function* (input) {
    yield* ServiceConfig.removeUrl(input.url)
  }),
)
