import { Effect } from "effect"
import { Commands } from "../../../commands"
import { Runtime } from "../../../../framework/runtime"
import { ServiceConfig } from "../../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.url.commands.add,
  Effect.fn("cli.service.url.add")(function* (input) {
    yield* ServiceConfig.addUrl(input.url)
  }),
)
