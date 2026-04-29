import type { Argv } from "yargs"
import { cmd } from "../cmd"

export const UninstallCommand = cmd({
  command: "uninstall",
  describe: "uninstall opencode and remove all related files",
  builder: (yargs: Argv) =>
    yargs
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "keep configuration files",
        default: false,
      })
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "keep session data and snapshots",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }),
  handler: async (args) => {
    await import("./handler").then(({ handler }) => handler(args))
  },
})

export type UninstallArgs = Parameters<NonNullable<typeof UninstallCommand.handler>>[0]
