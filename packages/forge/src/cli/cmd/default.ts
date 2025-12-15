import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { runDefaultTui } from "./agent-context"

export const DefaultCommand = cmd({
  command: "$0",
  describe: "start TUI",
  builder: (yargs: Argv) => {
    return yargs
  },
  handler: async (args: any) => {
    await runDefaultTui(args)
  },
})
