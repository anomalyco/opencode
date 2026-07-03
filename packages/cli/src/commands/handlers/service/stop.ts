import * as Effect from "effect/Effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("cli.service.stop")(function* () {
    yield* Service.stop(yield* ServiceConfig.options())
  }),
)
