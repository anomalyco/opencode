import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.config")(function* () {
    const configModule = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* configModule.Config.Service.use((cfg) => cfg.get())
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  }),
})
