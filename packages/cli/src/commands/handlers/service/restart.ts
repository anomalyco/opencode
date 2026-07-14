import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const options = yield* ServiceConfig.options()
    yield* Service.stop(options, { targetVersion: options.version })
    const transport = yield* Service.start(options)
    process.stdout.write(transport.url + EOL)
  }),
)
