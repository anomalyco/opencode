import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* () {
    const found = yield* Service.discover(yield* ServiceConfig.options())
    process.stdout.write((found ? found.url : "stopped") + EOL)
  }),
)
