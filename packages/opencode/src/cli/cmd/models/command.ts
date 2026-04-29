import type { Argv } from "yargs"
import { cmd } from "../cmd"

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type ModelsArgs = Parameters<NonNullable<typeof ModelsCommand.handler>>[0]
