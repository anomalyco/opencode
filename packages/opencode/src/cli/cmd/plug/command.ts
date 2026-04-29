import type { Argv } from "yargs"

import { cmd } from "../cmd"

export const PluginCommand = cmd({
  command: "plugin <module>",
  aliases: ["plug"],
  describe: "install plugin and update config",
  builder: (yargs: Argv) => {
    return yargs
      .positional("module", {
        type: "string",
        describe: "npm module name",
      })
      .option("global", {
        alias: ["g"],
        type: "boolean",
        default: false,
        describe: "install in global config",
      })
      .option("force", {
        alias: ["f"],
        type: "boolean",
        default: false,
        describe: "replace existing plugin version",
      })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type PluginArgs = Parameters<NonNullable<typeof PluginCommand.handler>>[0]
