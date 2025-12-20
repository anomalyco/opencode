import type { Argv } from "yargs"
import { cmd } from "../../cli/cmd/cmd"
import { setupProtectedMode } from "./commands/setup"
import { showSecurityStatus } from "./commands/status"
import { applySecurityConfiguration } from "./commands/lock"

export const ProtectCommand = cmd({
  command: "protect <action>",
  describe: "manage protected mode",
  builder: (yargs: Argv) => {
    return yargs.positional("action", {
      describe: "Action to perform",
      type: "string",
      choices: ["setup", "lock", "status"],
      demandOption: true,
    })
  },
  async handler(args) {
    switch (args.action) {
      case "setup":
        await setupProtectedMode()
        break
      case "lock":
        await applySecurityConfiguration()
        break
      case "status":
        await showSecurityStatus()
        break
    }
  },
})
