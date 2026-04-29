import type { Argv } from "yargs"
import { cmd } from "../cmd"

export const UpgradeCommand = cmd({
  command: "upgrade [target]",
  describe: "upgrade opencode to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type UpgradeArgs = Parameters<NonNullable<typeof UpgradeCommand.handler>>[0]
