import { EOL } from "os"
import { Effect, Option } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.start,
  Effect.fn("cli.service.start")(function* (input) {
    const options = yield* ServiceConfig.options({ port: Option.getOrUndefined(input.port) })
    const transport = yield* Service.ensure(options)
    process.stdout.write(transport.url + EOL)
  }),
)
