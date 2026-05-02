import { EOL } from "os"
import { Config, type Config as ConfigNamespace } from "../../../config"
import { AppRuntime } from "@/effect/app-runtime"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { UI } from "../../ui"
import { Effect } from "effect"

const MODEL_ID_REGEX = /^[\w-]+\/[\w-]+$/

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) =>
    yargs.command(ConfigSetCommand).command(ConfigShowCommand).demandCommand(),
  async handler() {},
})

export const ConfigSetCommand = cmd({
  command: "set <key> <value>",
  describe: "set a config value in .opencode",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", describe: "config key (e.g., model, image_model, small_model)" })
      .positional("value", { type: "string", describe: "config value (e.g., anthropic/claude-sonnet-4-20250514)" }),
  async handler(args) {
    const key = args.key as string
    const value = args.value as string
    if (!key || !value) {
      process.stderr.write("Error: both key and value are required\n")
      process.exit(1)
    }
    if (!MODEL_ID_REGEX.test(value)) {
      process.stderr.write(`Error: value must be in format provider/model (e.g., anthropic/claude-sonnet-4-20250514)\n`)
      process.exit(1)
    }
    const update: Partial<ConfigNamespace.Info> = { [key]: value }
    await bootstrap(process.cwd(), async () => {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const cfg = yield* Config.Service
          yield* cfg.update(update)
        }),
      )
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Set ${key} to ${value}` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const ConfigShowCommand = cmd({
  command: "show",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get()))
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    })
  },
})
