import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.start,
  Effect.fn("cli.service.start")(function* () {
    const transport = yield* Service.start(yield* ServiceConfig.options())
    process.stdout.write(transport.url + EOL)
  }),
)
