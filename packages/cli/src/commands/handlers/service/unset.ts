import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.unset,
  Effect.fn("cli.service.unset")(function* (input) {
    yield* ServiceConfig.unset(input.key)
  }),
)
