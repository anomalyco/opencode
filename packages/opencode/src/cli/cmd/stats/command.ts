import type { Argv } from "yargs"
import { cmd } from "../cmd"

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type StatsArgs = Parameters<NonNullable<typeof StatsCommand.handler>>[0]
