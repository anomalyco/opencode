import type { Argv } from "yargs"
import { cmd } from "../cmd"

export const ImportCommand = cmd({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  builder: (yargs: Argv) => {
    return yargs.positional("file", {
      describe: "path to JSON file or share URL",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type ImportArgs = Parameters<NonNullable<typeof ImportCommand.handler>>[0]
