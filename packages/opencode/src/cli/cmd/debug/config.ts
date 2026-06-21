import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, CliError } from "../../effect-cmd"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const MODEL_ID_REGEX = /^[\w-]+\/[\w-]+$/

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) =>
    yargs.command(ConfigSetCommand).command(ConfigShowCommand).demandCommand(),
  handler: Effect.fn("Cli.debug.config")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  }),
})

export const ConfigSetCommand = effectCmd({
  command: "set <key> <value>",
  describe: "set a config value in .opencode",
  builder: (yargs) =>
    yargs
      .positional("key", { type: "string", describe: "config key (e.g., model, image_model, small_model)" })
      .positional("value", { type: "string", describe: "config value (e.g., anthropic/claude-sonnet-4-20250514)" }),
  handler: Effect.fn("Cli.debug.config.set")(function* (args) {
    const key = args.key as string
    const value = args.value as string
    if (!key || !value) {
      yield* Effect.fail(new CliError({ message: "both key and value are required", exitCode: 1 }))
    }
    if (!MODEL_ID_REGEX.test(value)) {
      yield* Effect.fail(new CliError({ message: "value must be in format provider/model (e.g., anthropic/claude-sonnet-4-20250514)", exitCode: 1 }))
    }
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const cfg = yield* Config.Service
    const current = yield* cfg.get()
    const update = { ...current, [key]: value } as ConfigV1.Info
    yield* cfg.update(update)
    process.stdout.write(`Set ${key} to ${value}${EOL}`)
  }),
})

export const ConfigShowCommand = effectCmd({
  command: "show",
  describe: "show resolved configuration",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.config")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const cfg = yield* Config.Service
    const config = yield* cfg.get()
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  }),
})
