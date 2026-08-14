import type { Argv } from "yargs"
import { UI } from "../ui"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "show how to update moks (releases not ready)",
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
  handler: async () => {
    UI.println("Binary releases are not ready. Install from source: clone the repo and run bun install.")
    UI.println("Do not download from opencode.ai, the opencode-ai npm package, or brew opencode.")
  },
}
