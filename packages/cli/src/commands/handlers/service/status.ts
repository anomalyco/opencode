import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* () {
    const options = yield* ServiceConfig.options()
    const found = yield* Service.discover({ ...options, version: undefined })
    process.stdout.write((found?.url ?? "stopped") + EOL)
  }),
)
