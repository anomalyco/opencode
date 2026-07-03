import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const options = yield* ServiceConfig.options()
    yield* Service.stop(options)
    const transport = yield* Service.start(options)
    process.stdout.write(transport.url + EOL)
  }),
)
