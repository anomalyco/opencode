import { EOL } from "os"
import { Effect } from "effect"
import { Commands } from "../../../commands"
import { Runtime } from "../../../../framework/runtime"
import { ServiceConfig } from "../../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.url.commands.list,
  Effect.fn("cli.service.url.list")(function* () {
    process.stdout.write(JSON.stringify(yield* ServiceConfig.listUrls(), null, 2) + EOL)
  }),
)
