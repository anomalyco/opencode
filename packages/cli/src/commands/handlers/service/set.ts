import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.set,
  Effect.fn("cli.service.set")(function* (input) {
    yield* ServiceConfig.set(input.key, input.value)
  }),
)
